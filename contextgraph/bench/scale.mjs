// Scale and load stage: run after bench/run.mjs. Merges its numbers into results/results.json.
//   SCALES=264,5000,20000 node bench/scale.mjs
import fs from 'node:fs';
import { HydraStore } from '../src/store-hydradb.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { setNamespace } from '../src/text.mjs';
import { Bm25 } from '../src/bm25.mjs';
import { SIMILAR, TOOLS, SKILLS, ENTITY_NAMES, testTasks, score, mean, pct, schemaChars } from './lib.mjs';

const URL_ = process.env.HYDRA_URL || 'http://127.0.0.1:18443';
const K = Number(process.env.K || 6);
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const RUN = Date.now().toString(36);
const store = new HydraStore({ url: URL_ });
await store.init();
const OUT = new URL('../results/', import.meta.url);
const results = JSON.parse(fs.readFileSync(new URL('results.json', OUT), 'utf8'));

async function evalGraph(g, tasks, ns) {
  setNamespace(ns);
  const rows = [];
  for (const t of tasks) {
    const r = await g.retrieve(t.text, { k: K });
    const sel = r.tools.map(x => x.id);
    rows.push({ task: t, sel, ...score(sel, t.tools), ms: r.ms, requests: r.requests, chars: schemaChars(sel) });
  }
  return rows;
}
// ---------- load: latency under concurrency, and accuracy as the catalog grows ----------
async function loadTest(g, ns, concurrency, seconds, texts) {
  setNamespace(ns);
  const lat = [];
  const stop = Date.now() + seconds * 1000;
  let n = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async (_, w) => {
      let i = w;
      while (Date.now() < stop) {
        const t0 = performance.now();
        await g.retrieve(texts[i % texts.length], { k: K });
        lat.push(performance.now() - t0);
        n++;
        i += concurrency;
      }
    }),
  );
  lat.sort((a, b) => a - b);
  const q = p => +lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(1);
  return { concurrency, queries: n, perSec: Math.round(n / seconds), p50ms: q(0.5), p95ms: q(0.95), p99ms: q(0.99) };
}

const SCALES = (process.env.SCALES || '264,5000,20000').split(',').map(Number);
const vocab = [...new Set(TOOLS.flatMap(t => `${t.id} ${t.description}`.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3)))];
const SIZES = SCALES;
results.scale = (results.scale || []).filter(s => !SIZES.includes(s.catalogTools));
for (const size of SCALES) {
  const ns = `scale${size}-${RUN}`;
  log(`scale ${size}: seeding`);
  setNamespace(ns);
  const g = new ContextGraph(store, { k: K });
  const extra = [];
  const rnd = (() => { let s = 7; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); })();
  for (let i = 0; i < Math.max(0, size - TOOLS.length); i++) {
    const pick = () => vocab[Math.floor(rnd() * vocab.length)];
    const server = `syn${Math.floor(i / 25)}`;
    extra.push({ id: `${server}__${pick()}_${pick()}_${i}`, server, description: `${pick()} ${pick()} ${pick()} ${pick()} ${pick()} ${pick()}`, params: ['a'] });
  }
  const tools = [...TOOLS, ...extra];
  const t0 = performance.now();
  await g.seed({ tools, skills: SKILLS, servers: [...new Set(tools.map(t => t.server))] });
  for (const name of ENTITY_NAMES) await g.registerEntity(name);
  await g.loadSimilar(SIMILAR);
  const seedSec = +((performance.now() - t0) / 1000).toFixed(1);
  const rows = await evalGraph(g, testTasks, ns);
  const bm = new Bm25(tools.map(t => ({ id: t.id, text: `${t.id.replace(/__/g, ' ').replace(/_/g, ' ')} ${t.description}` })));
  const bmRows = testTasks.map(t => score(bm.search(t.text, K).map(x => x.id), t.tools));
  const texts = testTasks.map(t => t.text);
  const loads = [];
  for (const c of [1, 8, 32]) loads.push(await loadTest(g, ns, c, 6, texts));
  results.scale.push({
    catalogTools: tools.length,
    seedSeconds: seedSec,
    graphCompleteCold: +pct(rows.map(r => r.complete)).toFixed(1),
    bm25Complete: +pct(bmRows.map(r => r.complete)).toFixed(1),
    graphAvgRequests: +mean(rows.map(r => r.requests)).toFixed(2),
    preloadSchemaChars: tools.reduce((s, t) => s + 120 + (t.description?.length || 0) * 1.1 + (t.params?.length || 1) * 70, 0) | 0,
    graphSchemaChars: Math.round(mean(rows.map(r => r.chars))),
    load: loads,
  });
  log(`scale ${size}`, JSON.stringify(results.scale.at(-1)).slice(0, 300));
}


results.scale.sort((a, b) => a.catalogTools - b.catalogTools);
fs.writeFileSync(new URL('results.json', OUT), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results.scale.map(s => ({ n: s.catalogTools, cold: s.graphCompleteCold, bm25: s.bm25Complete, load: s.load })), null, 1));
