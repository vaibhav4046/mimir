// Restart test: seed and teach a graph in HydraDB, build a NEW ContextGraph object, restore() it from the store,
// and check it answers the 80 held-out tasks exactly as the original did.
//   node test/restore.mjs
import assert from 'node:assert/strict';
import { HydraStore } from '../src/store-hydradb.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { setNamespace } from '../src/text.mjs';
import { freshGraph, testTasks, trainTasks } from '../bench/lib.mjs';

const store = new HydraStore({ url: process.env.HYDRA_URL || 'http://127.0.0.1:18443' });
await store.init();
setNamespace(`restore-${Date.now().toString(36)}`);
const a = await freshGraph(store);
for (const t of trainTasks.slice(0, 40)) {
  const r = await a.retrieve(t.text);
  await a.learn({ text: t.text, used: t.tools, retrieved: r.tools.map(x => x.id) });
}
const b = new ContextGraph(store, { k: 6 });
const info = await b.restore();
console.log('restored:', JSON.stringify(info));
let same = 0;
for (const t of testTasks) {
  const x = await a.retrieve(t.text);
  const y = await b.retrieve(t.text);
  const ax = x.tools.map(v => `${v.id}:${v.score}`).join();
  const by = y.tools.map(v => `${v.id}:${v.score}`).join();
  if (ax === by) same++;
  else if (same + 1 < 3) console.log('differs:', t.text, '\n  ', ax, '\n  ', by);
}
console.log(`${same}/${testTasks.length} identical after restore`);
assert.equal(same, testTasks.length);
console.log('restore ok');
