import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { HydraContextRouter } from '../daemon/hydradb-context.mjs';

if (!process.env.MIMIR_HYDRADB_TOKEN) {
  console.error('A running self-hosted HydraDB and MIMIR_HYDRADB_TOKEN are required. Refusing to print mock results.');
  process.exit(2);
}

const names = [
  ['browser_search', 'Search the web for current research'],
  ['browser_open', 'Browse a web page or website'],
  ['fs_read', 'Read a local workspace file'],
  ['fs_write', 'Write a local workspace file'],
  ['shell_exec', 'Execute code or terminal shell commands'],
  ['memory_read', 'Recall agent memory facts'],
  ['memory_save', 'Remember a new memory fact'],
  ['knowledge_search', 'Search a knowledge base for source evidence'],
  ['subagent_loop', 'Delegate to an agent team member'],
  ['council_convene', 'Convene an agent council team'],
  ['routine_create', 'Schedule recurring automated routines'],
  ['foundry_create', 'Generate images, documents and creative media'],
  ['desktop_control', 'Click or navigate on the desktop'],
  ['email_send', 'Send an email message'],
  ['artifact_open', 'Open a generated document artifact'],
  ['git_commit', 'Commit source code changes'],
  ['web_fetch', 'Fetch a webpage from the browser'],
  ['browser_action', 'Perform an action on an open web page'],
];
const tools = names.map(([name, description]) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties: {} } },
}));

// Truth is declared BEFORE any graph result, never modified to fit results.
const cases = [
  { task: 'search current research on AI', expected: ['browser_search', 'knowledge_search'] },
  { task: 'read a local file', expected: ['fs_read'] },
  { task: 'edit and write source code', expected: ['fs_read', 'fs_write', 'shell_exec', 'git_commit'] },
  { task: 'remember this fact', expected: ['memory_save'] },
  { task: 'recall what we discussed earlier', expected: ['memory_read', 'knowledge_search'] },
  { task: 'delegate this work to a team', expected: ['subagent_loop', 'council_convene'] },
  { task: 'send an email', expected: ['email_send'] },
  { task: 'create an image', expected: ['foundry_create'] },
  { task: 'schedule a daily automated routine', expected: ['routine_create'] },
  { task: 'navigate a website and click a form', expected: ['browser_open', 'browser_action', 'desktop_control'] },
];
const router = new HydraContextRouter();
const scope = 'mimir-hydra-hackathon-eval-v1';
function stats(res) {
  const chosen = new Set(res.tools.map(t => t.function.name));
  const expected = new Set(res.expected);
  const truePositive = [...chosen].filter(x => expected.has(x)).length;
  return {
    hits: truePositive,
    chosen: chosen.size,
    expected: expected.size,
    fullyCovered: [...expected].every(x => chosen.has(x)),
    bytes: Buffer.byteLength(JSON.stringify(res.tools)),
  };
}
const results = [];
for (let round = 0; round < 3; round++) {
  const samples = [];
  for (const c of cases) {
    const start = performance.now();
    const outcome = await router.route(c.task, tools, { scope });
    samples.push({
      task: c.task,
      expected: c.expected,
      selected: outcome.tools.map(t => t.function.name),
      elapsedMs: Math.round((performance.now() - start) * 100) / 100,
      graphStatus: outcome.trace.status,
      ...stats({ tools: outcome.tools, expected: c.expected }),
    });
  }
  const sorted = samples.map(x => x.elapsedMs).sort((a,b)=>a-b);
  const sum = (key) => samples.reduce((a,s)=>a+s[key],0);
  const fullBytes = Buffer.byteLength(JSON.stringify(tools)) * cases.length;
  results.push({
    round: round+1,
    graphPrecision: sum('chosen') ? sum('hits') / sum('chosen') : 0,
    graphRecall: sum('expected') ? sum('hits') / sum('expected') : 0,
    completeTasks: samples.filter(s=>s.fullyCovered).length,
    totalTasks: samples.length,
    baselineFullContextBytes: fullBytes,
    graphContextBytes: sum('bytes'),
    contextReductionPct: 100 * (1 - sum('bytes') / fullBytes),
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samples,
  });
}
const out = {
  dataset: 'Mimir synthetic tool-schema relevance audit (10 preset tasks)',
  resultType: 'live self-hosted HydraDB graph reads and writes',
  limitations: [
    'Synthetic tool definitions, not a production user task distribution',
    'Byte length, not tokenizer-specific token count',
    'Repeated warm rounds demonstrate stability, not unsupervised learning',
    'No feedback edges are changed during this benchmark',
  ],
  time: new Date().toISOString(),
  graphEndpoint: process.env.MIMIR_HYDRADB_URL || 'http://127.0.0.1:8443',
  rounds: results,
};
const dir = path.join(process.cwd(), 'artifacts', 'hydradb');
fs.mkdirSync(dir, { recursive: true });
const filename = path.join(dir, 'benchmark-' + Date.now() + '.json');
fs.writeFileSync(filename, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ output: filename, summary: results.map(r => ({
  round: r.round, graphPrecision: r.graphPrecision, graphRecall: r.graphRecall,
  completeTasks: r.completeTasks, contextReductionPct: r.contextReductionPct,
  p50Ms: r.p50Ms, p95Ms: r.p95Ms,
})) }, null, 2));
