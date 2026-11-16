// Choose the live-embedding similarity floor with evidence: gibberish must not pull tools, real new words should.
import { MemoryStore } from '../src/store-memory.mjs';
import { setNamespace } from '../src/text.mjs';
import { createEmbedder } from '../src/embed-similar.mjs';
import { TASKS, freshGraph, evalGraph, pct } from './lib.mjs';
const TEST = TASKS.filter(t => t.split === 'test');
const gibberish = ['zzzz qqqq xxxx', 'asdf jkl qwerty', 'blorp wibble snarf', 'xkcd', 'lorem ipsum dolor sit amet', 'aaaaaa bbbbbb', 'hmm ok', 'tell me a joke about cats'];
for (const minSim of [0.5, 0.55, 0.6, 0.65, 0.7]) {
  setNamespace('thr-' + minSim);
  const g = await freshGraph(new MemoryStore(), { k: 6 }, true);
  g.embedUnknown = createEmbedder({ minSim });
  const rows = await evalGraph(g, TEST, 6);
  let confident = 0;
  for (const t of gibberish) if ((await g.retrieve(t)).confident) confident++;
  console.log(`minSim ${minSim}: held-out cold ${pct(rows.map(r => r.complete)).toFixed(1)}%   nonsense/off-topic prompts that look confident: ${confident}/${gibberish.length}`);
}
