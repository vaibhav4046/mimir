// A harder test than held-out wording: held-out JOBS. Train on half of the jobs (all three phrasings of each),
// test on the other half, then swap. Nothing about a test job was seen in training, so a method only gains
// if what it learned about other jobs transfers. Compares the graph with a flat index that also learns.
// Runs in process (the in-process store matches HydraDB exactly, see test/parity.mjs).
//   node bench/unseen-jobs.mjs        -> prints a table and merges `unseenJobs` into results/results.json
import fs from 'node:fs';
import { MemoryStore } from '../src/store-memory.mjs';
import { setNamespace } from '../src/text.mjs';
import { Bm25 } from '../src/bm25.mjs';
import { TOOLS, SKILLS, TASKS, freshGraph, evalGraph, evalBm25, pct, mean, shuffle } from './lib.mjs';

const K = 6;
const kinds = ['D', 'S', 'E'];
const toolText = t => `${t.id.replace(/__/g, ' ').replace(/_/g, ' ')} ${t.description}`;
const docs = extra => {
  const d = TOOLS.map(t => ({ id: t.id, text: toolText(t) }));
  for (const [name, desc, req] of SKILLS) d.push({ id: `skill:${name}`, text: `${name.replace(/-/g, ' ')} ${desc}`, toolIds: req });
  return [...d, ...extra];
};
const tally = rows => ({ complete: pct(rows.map(r => r.complete)), byKind: Object.fromEntries(kinds.map(k => [k, pct(rows.filter(r => r.task.kind === k).map(r => r.complete))])) });

const folds = [0, 1].map(f => ({
  train: TASKS.filter(t => t.capability % 2 === f),
  test: TASKS.filter(t => t.capability % 2 !== f),
}));
const acc = { 'Keyword search over tools and skills (no learning)': [], 'Keyword search that learns (experience documents)': [], 'Graph, cold start': [], 'Graph, after learning': [] };

for (const [fi, { train, test }] of folds.entries()) {
  setNamespace(`unseen-${fi}`);
  acc['Keyword search over tools and skills (no learning)'].push(tally(evalBm25(new Bm25(docs([])), test, K)));
  acc['Keyword search that learns (experience documents)'].push(
    tally(evalBm25(new Bm25(docs(train.map((t, i) => ({ id: `exp:${i}`, text: t.text, toolIds: t.tools })))), test, K)),
  );
  const g = await freshGraph(new MemoryStore());
  acc['Graph, cold start'].push(tally(await evalGraph(g, test, K)));
  for (const t of shuffle(train, 7 + fi)) {
    const r = await g.retrieve(t.text, { k: K });
    await g.learn({ text: t.text, used: t.tools, retrieved: r.tools.map(x => x.id) });
  }
  acc['Graph, after learning'].push(tally(await evalGraph(g, test, K)));
}

const rows = Object.entries(acc).map(([label, folds2]) => ({
  label,
  complete: +mean(folds2.map(f => f.complete)).toFixed(1),
  byKind: Object.fromEntries(kinds.map(k => [k, +mean(folds2.map(f => f.byKind[k])).toFixed(1)])),
}));
console.log(`unseen jobs: train on half the jobs, test on the other half (${TASKS.length / 2} tasks each way), averaged over two folds`);
for (const r of rows) console.log(`${r.label.padEnd(58)} complete ${String(r.complete).padStart(5)}%   D ${r.byKind.D}  S ${r.byKind.S}  E ${r.byKind.E}`);

const file = new URL('../results/results.json', import.meta.url);
const R = JSON.parse(fs.readFileSync(file, 'utf8'));
R.unseenJobs = { note: 'Train on half of the jobs, test on the other half (all phrasings), then swap and average. No test job was seen in training.', rows };
fs.writeFileSync(file, JSON.stringify(R, null, 1));
console.log('merged unseenJobs into results/results.json');
