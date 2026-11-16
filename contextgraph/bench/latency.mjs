// Retrieval latency against a real HydraDB node, warmed, over varied requests (some with words the graph has never seen).
//   node bench/latency.mjs
import { HydraStore } from '../src/store-hydradb.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { setNamespace } from '../src/text.mjs';
import { TOOLS, SERVERS, SKILLS, ENTITY_NAMES, SIMILAR, EMBEDDER } from './lib.mjs';
const store = new HydraStore();
await store.init();
const ns = `lat-${Date.now().toString(36)}`;
setNamespace(ns);
const g = new ContextGraph(store, { k: 6, embedBudgetMs: 40 });
await g.seed({ tools: TOOLS, skills: SKILLS, servers: SERVERS.map(s => s.name) });
for (const name of ENTITY_NAMES) await g.registerEntity(name);
await g.loadSimilar(SIMILAR);
if (EMBEDDER) g.embedUnknown = EMBEDDER;
await g.retrieve('qwertyuiop'); // warm the embedder
const prompts = ['Send an email to my supplier asking for a quote', 'Plan the offsite workshop and book the venue', 'Refund the duplicate charge for Acme and email them', 'Review pull request 88 properly', 'What is the weather in Berlin tomorrow', 'Handle the outage: dig into the errors and post an update', 'Schedule a standup with the team on Monday', 'Summarise the last support tickets from Sweetcrumb', 'Deploy the website to production', 'Show me unfulfilled orders in the shop', 'Roll back the last release and tell the channel', 'Translate this contract into German and file it'];
const rows = [];
for (let round = 0; round < 25; round++) {
  for (const p of prompts) {
    const text = round % 5 === 0 ? `${p} blorbwave${round}` : p; // every fifth round adds a brand-new word
    const t = performance.now();
    const r = await g.retrieve(text);
    rows.push({ ms: performance.now() - t, requests: r.requests, fresh: round % 5 === 0 });
  }
}
const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const all = rows.map(r => r.ms);
const warm = rows.filter(r => !r.fresh).map(r => r.ms);
const fresh = rows.filter(r => r.fresh).map(r => r.ms);
const f = x => x.toFixed(0);
console.log(`n=${rows.length} requests/retrieve=${(rows.reduce((s, r) => s + r.requests, 0) / rows.length).toFixed(1)}`);
console.log(`all:   p50 ${f(q(all, 0.5))} ms  p95 ${f(q(all, 0.95))}  p99 ${f(q(all, 0.99))}  max ${f(Math.max(...all))}`);
console.log(`known words only: p50 ${f(q(warm, 0.5))}  p95 ${f(q(warm, 0.95))}  p99 ${f(q(warm, 0.99))}`);
console.log(`with a new word:  p50 ${f(q(fresh, 0.5))}  p95 ${f(q(fresh, 0.95))}  max ${f(Math.max(...fresh))}`);
