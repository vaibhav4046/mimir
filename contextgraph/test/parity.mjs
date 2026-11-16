// The HydraDB store and the in-process store must give identical answers for the same graph,
// before and after learning. Run against a live node:  node test/parity.mjs
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store-memory.mjs';
import { HydraStore } from '../src/store-hydradb.mjs';
import { freshGraph, testTasks, trainTasks, shuffle } from '../bench/lib.mjs';
import { setNamespace } from '../src/text.mjs';

const ns = `parity-${Date.now().toString(36)}`;
const hyd = new HydraStore({ url: process.env.HYDRA_URL || 'http://127.0.0.1:18443' });
await hyd.init();
setNamespace(ns);
const gm = await freshGraph(new MemoryStore());
setNamespace(ns);
const gh = await freshGraph(hyd);
let compared = 0;
const same = async label => {
  let diff = 0;
  for (const t of testTasks) {
    setNamespace(ns);
    const a = (await gm.retrieve(t.text)).tools.map(x => x.id);
    const b = (await gh.retrieve(t.text)).tools.map(x => x.id);
    compared++;
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diff++;
      if (diff <= 3) console.log(`  ${label} differs for "${t.text}"\n   mem  ${a.join(' ')}\n   hydra ${b.join(' ')}`);
    }
  }
  console.log(`${label}: ${testTasks.length - diff}/${testTasks.length} identical`);
  return diff;
};
const d0 = await same('cold');
for (const t of shuffle(trainTasks, 3).slice(0, 60)) {
  setNamespace(ns);
  const rm = await gm.retrieve(t.text);
  await gm.learn({ text: t.text, used: t.tools, retrieved: rm.tools.map(x => x.id) });
  setNamespace(ns);
  const rh = await gh.retrieve(t.text);
  await gh.learn({ text: t.text, used: t.tools, retrieved: rh.tools.map(x => x.id) });
}
const d1 = await same('after 60 learned examples');
assert.equal(d0 + d1, 0, 'stores disagree');
console.log(`parity ok over ${compared} retrievals`);
