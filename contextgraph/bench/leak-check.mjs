// Is the semantic bridge's gain real, or did its vocabulary peek at the held-out wording?
// Cold start (no learning) on the 80 held-out tasks with: no bridge / bridge built from catalog+skills+TRAIN tasks only / bridge built from everything (the old, leaky way).
//   node bench/leak-check.mjs
import fs from 'node:fs';
import { MemoryStore } from '../src/store-memory.mjs';
import { setNamespace } from '../src/text.mjs';
import { TASKS, freshGraph, evalGraph, pct } from './lib.mjs';

const TEST = TASKS.filter(t => t.split === 'test');
const load = f => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8')).similar;
const run = async (label, similar) => {
  setNamespace('leak-' + label.replace(/\W/g, ''));
  const g = await freshGraph(new MemoryStore(), { k: 6 }, false);
  if (similar) await g.loadSimilar(similar);
  const rows = await evalGraph(g, TEST, 6);
  const by = k => pct(rows.filter(r => r.task.kind === k).map(r => r.complete));
  const out = { label, complete: pct(rows.map(r => r.complete)), D: by('D'), S: by('S'), E: by('E') };
  console.log(`${label.padEnd(44)} complete ${String(out.complete).padStart(5)}%   D ${out.D}%  S ${out.S}%  E ${out.E}%`);
  return out;
};
const result = {
  noBridge: await run('no bridge', null),
  clean: await run('bridge from catalog+skills+TRAIN words only', load('similar.clean.json')),
  leaky: await run('bridge from all words incl. held-out (old)', load('similar.leaky.json')),
};
fs.writeFileSync(new URL('../results/leak-check.json', import.meta.url), JSON.stringify(result, null, 2));
