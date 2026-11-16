// Fast sanity run on the in-process store. The reported benchmark (run.mjs) uses HydraDB.
import { MemoryStore } from '../src/store-memory.mjs';
import { freshGraph, bm25Tools, bm25WithSkills, evalGraph, evalBm25, trainTasks, testTasks, shuffle, pct, byKind, TOOLS, toolIdSet, TASKS } from './lib.mjs';

for (const t of TASKS) for (const r of t.tools) if (!toolIdSet.has(r)) throw new Error(`task ${t.id} needs unknown tool ${r}`);
const K = 6;
const line = (name, rows) => console.log(name.padEnd(26), 'complete', pct(rows.map(r => r.complete)).toFixed(1).padStart(5), '| recall', pct(rows.map(r => r.recall)).toFixed(1).padStart(5), '| D', pct(byKind(rows, 'D').map(r => r.complete)).toFixed(0).padStart(3), 'S', pct(byKind(rows, 'S').map(r => r.complete)).toFixed(0).padStart(3), 'E', pct(byKind(rows, 'E').map(r => r.complete)).toFixed(0).padStart(3));
console.log(`tools ${TOOLS.length}, train ${trainTasks.length}, test ${testTasks.length}`);
line('BM25 tools', evalBm25(bm25Tools(), testTasks, K));
line('BM25 tools+skills', evalBm25(bm25WithSkills(), testTasks, K));
const withSim = process.env.SIMILAR !== '0';
const g = await freshGraph(new MemoryStore(), {}, withSim);
console.log('semantic bridge:', withSim);
line('graph cold', await evalGraph(g, testTasks, K));
for (let epoch = 1; epoch <= 5; epoch++) {
  for (const t of shuffle(trainTasks, epoch)) {
    const r = await g.retrieve(t.text, { k: K });
    await g.learn({ text: t.text, used: t.tools, retrieved: r.tools.map(x => x.id) });
  }
  line(`graph after epoch ${epoch}`, await evalGraph(g, testTasks, K));
}
