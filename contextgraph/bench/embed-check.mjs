// Does embedding unseen words at query time recover the bridge's value without any held-out peek?
// Cold start on the 80 held-out tasks. The offline vocabulary is catalog + skills + TRAIN tasks only.
//   node bench/embed-check.mjs
import fs from 'node:fs';
import { MemoryStore } from '../src/store-memory.mjs';
import { setNamespace } from '../src/text.mjs';
import { createEmbedder } from '../src/embed-similar.mjs';
import { TASKS, freshGraph, evalGraph, pct } from './lib.mjs';

const TEST = TASKS.filter(t => t.split === 'test');
const run = async (label, withEmbedder) => {
  setNamespace('emb-' + label.replace(/\W/g, ''));
  const g = await freshGraph(new MemoryStore(), { k: 6 }, true);
  if (withEmbedder) g.embedUnknown = createEmbedder();
  const rows = await evalGraph(g, TEST, 6);
  const by = k => pct(rows.filter(r => r.task.kind === k).map(r => r.complete));
  const o = { label, complete: pct(rows.map(r => r.complete)), D: by('D'), S: by('S'), E: by('E'), avgMs: +(rows.reduce((s, r) => s + r.ms, 0) / rows.length).toFixed(1) };
  console.log(`${label.padEnd(48)} complete ${o.complete.toFixed(1)}%  D ${by('D').toFixed(1)}  S ${by('S').toFixed(1)}  E ${by('E').toFixed(1)}  avg ${o.avgMs} ms`);
  return o;
};
const out = [await run('clean bridge (offline vocabulary only)', false), await run('clean bridge + query-time embedding of new words', true)];
fs.writeFileSync(new URL('../results/embed-check.json', import.meta.url), JSON.stringify(out, null, 1));
