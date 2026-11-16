// Two separate processes learn into the same HydraDB graph at the same time. Neither may crash, and the
// shared graph must still answer correctly afterwards. (Concurrent edge updates may overwrite each other;
// that costs a little learning, not correctness. This test proves there is no crash or corruption.)
//   node test/two-writers.mjs
import { spawn } from 'node:child_process';
import { HydraStore } from '../src/store-hydradb.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { setNamespace } from '../src/text.mjs';
import { TOOLS, SERVERS, SKILLS, ENTITY_NAMES, TASKS } from '../bench/lib.mjs';

if (process.argv[2] === 'child') {
  const [, , , ns, part] = process.argv;
  const store = new HydraStore();
  await store.init();
  setNamespace(ns);
  const g = new ContextGraph(store, { k: 6 });
  await g.restore(t => t.split('__')[0]);
  const mine = TASKS.filter(t => t.split === 'train').filter((_, i) => i % 2 === Number(part));
  for (const t of mine) await g.learn({ text: t.text, used: t.tools, retrieved: [] });
  console.log(`writer ${part} learned ${mine.length}`);
  process.exit(0);
}

const ns = `two-writers-${Date.now().toString(36)}`;
const store = new HydraStore();
await store.init();
setNamespace(ns);
const g = new ContextGraph(store, { k: 6 });
await g.seed({ tools: TOOLS, skills: SKILLS, servers: SERVERS.map(s => s.name) });
for (const name of ENTITY_NAMES) await g.registerEntity(name);
const run = part => new Promise((resolve, reject) => {
  const c = spawn(process.execPath, [new URL(import.meta.url).pathname.replace(/^\//, ''), 'child', ns, String(part)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  c.stdout.on('data', d => (out += d));
  c.on('exit', code => (code === 0 ? resolve(out.trim()) : reject(new Error(`writer ${part} exited ${code}`))));
});
const outs = await Promise.all([run(0), run(1)]);
console.log(outs.join(' | '));
const after = new ContextGraph(store, { k: 6 });
await after.restore(t => t.split('__')[0]);
const test = TASKS.filter(t => t.split === 'test');
let complete = 0;
for (const t of test) {
  const r = await after.retrieve(t.text);
  const got = new Set(r.tools.map(x => x.id));
  if (t.tools.every(x => got.has(x))) complete++;
}
const pctDone = (100 * complete) / test.length;
console.log(`after two concurrent writers: held-out coverage ${pctDone.toFixed(1)}% (${complete}/${test.length})`);
if (pctDone < 55) throw new Error('graph looks corrupted by concurrent writers');
console.log('two-writers ok');
