// Cold-start ablation on the 80 held-out tasks (in-process; parity with HydraDB is verified by test/parity.mjs).
//   node bench/ablation.mjs
import { MemoryStore } from '../src/store-memory.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { setNamespace } from '../src/text.mjs';
import { TOOLS, SERVERS, SKILLS, ENTITY_NAMES, SIMILAR, TASKS, freshGraph, evalGraph, pct } from './lib.mjs';

const TEST = TASKS.filter(t => t.split === 'test');
const tally = (label, rows) => ({
  label,
  complete: pct(rows.map(r => r.complete)),
  D: pct(rows.filter(r => r.task.kind === 'D').map(r => r.complete)),
  S: pct(rows.filter(r => r.task.kind === 'S').map(r => r.complete)),
  E: pct(rows.filter(r => r.task.kind === 'E').map(r => r.complete)),
});

setNamespace('abl-full');
const gFull = await freshGraph(new MemoryStore(), { k: 6 }, true);
const rFull = tally('Full cold graph', await evalGraph(gFull, TEST, 6));

setNamespace('abl-nosim');
const gNoSim = await freshGraph(new MemoryStore(), { k: 6 }, false);
const rNoSim = tally('No similar-word bridge', await evalGraph(gNoSim, TEST, 6));

setNamespace('abl-noskill');
const gNoSkill = new ContextGraph(new MemoryStore(), { k: 6 });
await gNoSkill.seed({ tools: TOOLS, skills: [], servers: SERVERS.map(s => s.name) });
for (const name of ENTITY_NAMES) await gNoSkill.registerEntity(name);
if (SIMILAR.length) await gNoSkill.loadSimilar(SIMILAR);
const rNoSkill = tally('No skills', await evalGraph(gNoSkill, TEST, 6));

for (const r of [rFull, rNoSim, rNoSkill]) {
  console.log(`${r.label.padEnd(26)} complete ${String(r.complete).padStart(5)}%   D ${r.D}%  S ${r.S}%  E ${r.E}%`);
}
