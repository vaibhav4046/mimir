// Does a small local model over-call tools? Real Mimir tool schemas + real curation, real Ollama.
//   node tests/tool-gate-bench.mjs [model]        (needs Ollama with the model pulled)
// Variants:
//   curated      what Mimir offers today (role curation for small models)
//   gate         curated, but no tools at all when the request shows no sign of needing one
//   graph        curated, then Context Graph (in-memory, cold start) narrows the list
// Prompts were written before any variant was run and are not tuned afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppStore } from '../daemon/store.mjs';
import { LocalExecEngine, curateToolsForBotTurn, filterToolsForExecutionMode } from '../daemon/local-exec.mjs';
import { AgentContextGraph } from '../daemon/context-graph.mjs';
import { MemoryStore } from '../contextgraph/src/store-memory.mjs';
import { needsToolsGate } from './tool-gate.mjs';

const MODEL = process.argv[2] || 'qwen3:1.7b';
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// need: tools that count as a correct first call. [] means answer in plain text, no tool.
const PROMPTS = [
  { text: 'hi, how are you today?', need: [] },
  { text: 'What is 17 times 23?', need: [] },
  { text: 'Explain what a closure is in JavaScript in two sentences.', need: [] },
  { text: 'Rewrite this to sound friendlier: "Your request has been denied."', need: [] },
  { text: 'Give me three name ideas for a coffee shop.', need: [] },
  { text: 'What is the capital of Australia?', need: [] },
  { text: 'Is it better to rent or buy a house? Keep it short.', need: [] },
  { text: 'Translate "good morning" into Spanish and French.', need: [] },
  { text: 'Summarize in one line: Mimir is a free assistant that runs on your own computer with local models.', need: [] },
  { text: 'Thanks, that was helpful!', need: [] },
  { text: 'Can you tell me a short joke about programmers?', need: [] },
  { text: 'What is the difference between TCP and UDP?', need: [] },
  { text: 'Help me think through whether to learn Rust or Go first.', need: [] },
  { text: 'Write a two-line poem about rain.', need: [] },
  { text: 'How many days are in a leap year?', need: [] },
  { text: 'Convert 70 degrees Fahrenheit to Celsius.', need: [] },
  { text: 'Remember that my sister is called Priya.', need: ['memory_save'] },
  { text: 'What did I tell you about my sister?', need: ['memory_read', 'knowledge_search'] },
  { text: 'Look up the latest Node.js LTS version online.', need: ['browser_search'] },
  { text: 'Create a file called todo.md with three tasks for tomorrow.', need: ['fs_write'] },
  { text: 'What files do I have in my workspace?', need: ['fs_list'] },
  { text: 'Show me what is inside package.json.', need: ['fs_read'] },
  { text: 'Run npm test and tell me if it passes.', need: ['shell_exec'] },
  { text: 'Open example.com and tell me the main heading.', need: ['browser_open', 'browser_search'] },
  { text: 'Search my knowledge base for the onboarding policy.', need: ['knowledge_search'] },
  { text: 'Save a note that the launch date moved to Friday.', need: ['memory_save', 'fs_write'] },
  { text: 'Read notes.txt and give me the key points.', need: ['fs_read'] },
  { text: 'Put the meeting summary into a document I can download.', need: ['fs_write', 'foundry_create'] },
  { text: 'Ask the team to draft a launch tagline.', need: ['subagent_loop'] },
  { text: 'Find out who won the most recent Formula 1 race.', need: ['browser_search'] },
  { text: 'List everything in the reports folder.', need: ['fs_list'] },
  { text: 'What is in my notes about pricing?', need: ['knowledge_search', 'fs_read', 'memory_read'] },
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-gate-'));
const store = new AppStore(tmp);
const bot = { ...store.getBot('bot-grok-default'), role: 'Chief of staff', specialistTag: 'chief' };
const engine = new LocalExecEngine({ store });
const all = filterToolsForExecutionMode(engine.getBuiltinToolSchemas(bot), 'agent');
const nameOf = t => t?.function?.name || t?.name;
// Neutral on purpose: a prompt that says "answer directly" or "use tools" would steer the very behaviour measured.
const SYSTEM = process.env.BENCH_SYSTEM || 'You are Mimir, a helpful assistant.';

const cg = new AgentContextGraph({ store: new MemoryStore(), namespace: 'bench', getSettings: () => ({ contextGraph: { enabled: true } }) });

async function offerFor(variant, text) {
  const curated = curateToolsForBotTurn(all, { bot, userText: text, modelName: MODEL });
  if (variant === 'curated') return curated;
  if (variant === 'graph+hint') variant = 'graph';
  if (variant === 'gate') return needsToolsGate(text) ? curated : [];
  if (variant === 'gate+graph' && !needsToolsGate(text)) return [];
  const pulled = await cg.select(text, curated);
  return pulled || curated;
}
// Graph narrowed the list: tell the model which tools were pulled for this request.
const hintFor = (variant, offered, curated) => (variant === 'graph+hint' && offered.length < curated.length ? `The tools most relevant to this request: ${offered.map(nameOf).join(', ')}. If the request needs an action, call one of them.` : '');

async function ask(text, tools, hint = '') {
  const body = { model: MODEL, stream: false, think: false, messages: [{ role: 'system', content: hint ? `${SYSTEM} ${hint}` : SYSTEM }, { role: 'user', content: text }], options: { num_ctx: 8192, temperature: 0 } };
  if (tools.length) body.tools = tools;
  const t0 = performance.now();
  const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  return { calls: (j.message?.tool_calls || []).map(c => c.function?.name), ms: performance.now() - t0, tokens: j.prompt_eval_count || 0 };
}

const out = { model: MODEL, system: SYSTEM, toolsInFullList: all.length, prompts: PROMPTS.length, variants: {} };
// Load the model first so the first variant does not pay the cold start in its latency.
await ask('hi', []).catch(() => {});
for (const variant of (process.env.BENCH_VARIANTS || 'curated,gate,graph,gate+graph,graph+hint').split(',')) {
  const rows = [];
  for (const p of PROMPTS) {
    const offered = await offerFor(variant, p.text);
    const curatedLen = curateToolsForBotTurn(all, { bot, userText: p.text, modelName: MODEL });
    let r;
    try { r = await ask(p.text, offered, hintFor(variant, offered, curatedLen)); } catch (e) { r = { calls: [], ms: 0, tokens: 0, error: e.message }; }
    const first = r.calls[0] || null;
    const noToolPrompt = p.need.length === 0;
    const ok = noToolPrompt ? !first : Boolean(first && p.need.includes(first));
    rows.push({ text: p.text, noToolPrompt, offered: offered.map(nameOf), first, ok, canSucceed: noToolPrompt || offered.some(t => p.need.includes(nameOf(t))), ms: Math.round(r.ms), tokens: r.tokens, error: r.error });
    process.stderr.write(`${variant.padEnd(8)} ${ok ? 'ok  ' : 'FAIL'} offered=${offered.length} first=${first} :: ${p.text.slice(0, 50)}\n`);
  }
  const pct = (xs, f) => (xs.length ? +(100 * xs.filter(f).length / xs.length).toFixed(1) : null);
  const plain = rows.filter(r => r.noToolPrompt);
  const needy = rows.filter(r => !r.noToolPrompt);
  out.variants[variant] = {
    unneededToolCallPct: pct(plain, r => r.first),
    correctFirstToolPct: pct(needy, r => r.ok),
    toolWasOfferedPct: pct(needy, r => r.canSucceed),
    overallOkPct: pct(rows, r => r.ok),
    avgToolsOffered: +(rows.reduce((s, r) => s + r.offered.length, 0) / rows.length).toFixed(1),
    avgPromptTokens: Math.round(rows.reduce((s, r) => s + r.tokens, 0) / rows.length),
    avgMs: Math.round(rows.reduce((s, r) => s + r.ms, 0) / rows.length),
    errors: rows.filter(r => r.error).length,
    rows,
  };
}
const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'docs', 'tool-gate-bench.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out.variants)) {
  const { rows, ...s } = v;
  console.log(k.padEnd(8), JSON.stringify(s));
}
fs.rmSync(tmp, { recursive: true, force: true });
