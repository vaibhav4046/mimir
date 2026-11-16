// A flat index that also learns from feedback: the fair comparison for the graph.
// Same training tasks, same held-out tasks, same k as bench/run.mjs. No graph, no HydraDB.
//   node bench/flat-learner.mjs         -> prints a table and merges `flatLearner` into results/results.json
import fs from 'node:fs';
import { Bm25 } from '../src/bm25.mjs';
import { TOOLS, SKILLS, trainTasks, testTasks, evalBm25, pct, mean } from './lib.mjs';

const K = 6;
const toolText = t => `${t.id.replace(/__/g, ' ').replace(/_/g, ' ')} ${t.description}`;
const baseDocs = () => {
  const docs = TOOLS.map(t => ({ id: t.id, text: toolText(t) }));
  for (const [name, desc, req] of SKILLS) docs.push({ id: `skill:${name}`, text: `${name.replace(/-/g, ' ')} ${desc}`, toolIds: req });
  return docs;
};

// A: every training task becomes a document that carries the tools it used (query -> tool set).
const experienceDocs = tasks => [...baseDocs(), ...tasks.map((t, i) => ({ id: `exp:${i}`, text: t.text, toolIds: t.tools }))];
// B: the training task's words are appended to the text of each tool it used.
const expandedDocs = tasks => {
  const extra = new Map();
  for (const t of tasks) for (const id of t.tools) extra.set(id, `${extra.get(id) || ''} ${t.text}`);
  return [...TOOLS.map(t => ({ id: t.id, text: `${toolText(t)} ${extra.get(t.id) || ''}` })), ...baseDocs().filter(d => d.id.startsWith('skill:'))];
};

const kinds = ['D', 'S', 'E'];
function summarise(label, docs, tasks) {
  const rows = evalBm25(new Bm25(docs), tasks, K);
  const by = Object.fromEntries(kinds.map(k => [k, +pct(rows.filter(r => r.task.kind === k).map(r => r.complete)).toFixed(1)]));
  return { label, complete: +pct(rows.map(r => r.complete)).toFixed(1), byKind: by, avgTools: +mean(rows.map(r => r.loaded)).toFixed(2) };
}

const rows = [
  summarise('Keyword search over tools and skills (no learning)', baseDocs(), testTasks),
  summarise('Keyword search that learns: experience documents', experienceDocs(trainTasks), testTasks),
  summarise('Keyword search that learns: words appended to used tools', expandedDocs(trainTasks), testTasks),
];
console.log('held-out tasks:', testTasks.length, ' training tasks:', trainTasks.length);
for (const r of rows) console.log(`${r.label.padEnd(62)} complete ${String(r.complete).padStart(5)}%   D ${r.byKind.D}  S ${r.byKind.S}  E ${r.byKind.E}   tools ${r.avgTools}`);

const file = new URL('../results/results.json', import.meta.url);
const R = JSON.parse(fs.readFileSync(file, 'utf8'));
R.flatLearner = { note: 'In-process keyword index given the same 160 training tasks as the graph; evaluated on the same 80 held-out tasks.', rows };
fs.writeFileSync(file, JSON.stringify(R, null, 1));
console.log('merged flatLearner into results/results.json');
