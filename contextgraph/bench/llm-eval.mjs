// End-to-end check with a real local model: given a task and a tool list, does the model call a
// tool the task actually needs? Compares the full catalog preloaded against what each retriever
// hands over. Needs Ollama (default http://127.0.0.1:11434) with the model pulled.
//   node bench/llm-eval.mjs <selections.json> <out.json> [model] [limit]
import fs from 'node:fs';
import { TOOLS, toSchema, TASKS } from './lib.mjs';

const [selFile, outFile, model = 'qwen3:1.7b', limitArg = '40'] = process.argv.slice(2);
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const selections = JSON.parse(fs.readFileSync(selFile, 'utf8')); // { method: { taskId: [toolIds] } }
const schemaById = new Map(TOOLS.map(t => [t.id, toSchema(t)]));

// Same sample every run: every other test task, stratified by kind order in the file.
const testTasks = TASKS.filter(t => t.split === 'test');
const sample = testTasks.filter((_, i) => i % Math.max(1, Math.round(testTasks.length / Number(limitArg))) === 0).slice(0, Number(limitArg));

const SYSTEM = 'You are an assistant with tools. Call the single best tool for the user request. Do not answer in text.';

async function ask(task, toolIds, numCtx) {
  const tools = toolIds.map(id => schemaById.get(id)).filter(Boolean);
  const body = {
    model,
    stream: false,
    think: false,
    messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: task.text }],
    tools,
    options: { num_ctx: numCtx, temperature: 0 },
  };
  const t0 = performance.now();
  const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const calls = (j.message?.tool_calls || []).map(c => c.function?.name);
  return { calls, promptTokens: j.prompt_eval_count || 0, ms: performance.now() - t0, text: (j.message?.content || '').slice(0, 80) };
}

const methods = { 'all tools preloaded': () => TOOLS.map(t => t.id), ...Object.fromEntries(Object.keys(selections).map(m => [m, t => selections[m][t.id] || []])) };
const out = { model, sampleSize: sample.length, methods: {} };
for (const [name, pick] of Object.entries(methods)) {
  const rows = [];
  for (const task of sample) {
    const ids = pick(task);
    const numCtx = ids.length > 60 ? 40960 : 8192;
    let r;
    try {
      r = await ask(task, ids, numCtx);
    } catch (e) {
      r = { calls: [], promptTokens: 0, ms: 0, error: e.message };
    }
    const first = r.calls[0];
    const need = new Set(task.tools);
    rows.push({ id: task.id, kind: task.kind, tools: ids.length, firstCall: first || null, hit: Boolean(first && need.has(first)), offered: ids.some(i => need.has(i)), promptTokens: r.promptTokens, ms: Math.round(r.ms), error: r.error });
    process.stderr.write(`${name.padEnd(22)} ${task.id} ${r.error ? 'ERR' : rows.at(-1).hit ? 'hit ' : 'miss'} tools=${ids.length} tok=${r.promptTokens} ${Math.round(r.ms)}ms\n`);
  }
  const mean = f => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  out.methods[name] = {
    firstCallHitPct: +(100 * mean(r => (r.hit ? 1 : 0))).toFixed(1),
    toolOfferedPct: +(100 * mean(r => (r.offered ? 1 : 0))).toFixed(1),
    avgToolsOffered: +mean(r => r.tools).toFixed(1),
    avgPromptTokens: Math.round(mean(r => r.promptTokens)),
    avgMs: Math.round(mean(r => r.ms)),
    rows,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(out.methods).map(([k, v]) => [k, { hit: v.firstCallHitPct, offered: v.toolOfferedPct, tools: v.avgToolsOffered, tokens: v.avgPromptTokens, ms: v.avgMs }])), null, 1));
