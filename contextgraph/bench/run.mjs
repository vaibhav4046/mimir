// The benchmark. Every "graph" number below comes from a running HydraDB node.
//   node bench/run.mjs            (HYDRA_URL, default http://127.0.0.1:18443)
// Writes results/results.json and results/selections.json (inputs for the local-model test).
import fs from 'node:fs';
import { HydraStore } from '../src/store-hydradb.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { setNamespace, nodeId } from '../src/text.mjs';
import { Bm25 } from '../src/bm25.mjs';
import {
  SIMILAR, TOOLS, SERVERS, SKILLS, TASKS, ENTITY_NAMES, ALL_SCHEMA_CHARS, bm25Tools, bm25WithSkills, evalBm25, score, mean, sd, pct, shuffle, trainTasks, testTasks, schemaChars, toolIdSet,
} from './lib.mjs';

for (const t of TASKS) for (const r of t.tools) if (!toolIdSet.has(r)) throw new Error(`task ${t.id} needs unknown tool ${r}`);

const URL_ = process.env.HYDRA_URL || 'http://127.0.0.1:18443';
const K = Number(process.env.K || 6);
const TRIALS = Number(process.env.TRIALS || 5);
const EPOCHS = Number(process.env.EPOCHS || 5);
const OUT = new URL('../results/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

const RUN = Date.now().toString(36); // every run gets its own namespaces: nothing from an earlier run can leak into a 'cold' graph
const store = new HydraStore({ url: URL_ });
await store.init();

async function freshGraph(ns) {
  setNamespace(ns);
  const g = new ContextGraph(store, { k: K });
  await g.seed({ tools: TOOLS, skills: SKILLS, servers: SERVERS.map(s => s.name) });
  for (const name of ENTITY_NAMES) await g.registerEntity(name);
  await g.loadSimilar(SIMILAR);
  return g;
}

async function evalGraph(g, tasks, ns) {
  setNamespace(ns);
  const rows = [];
  for (const t of tasks) {
    const r = await g.retrieve(t.text, { k: K });
    const sel = r.tools.map(x => x.id);
    rows.push({ task: t, sel, top: r.tools[0]?.score || 0, confident: r.confident, ...score(sel, t.tools), ms: r.ms, requests: r.requests, chars: schemaChars(sel) });
  }
  return rows;
}

const summarize = rows => ({
  complete: +pct(rows.map(r => r.complete)).toFixed(1),
  recall: +pct(rows.map(r => r.recall)).toFixed(1),
  precision: +pct(rows.map(r => r.precision)).toFixed(1),
  avgTools: +mean(rows.map(r => r.loaded)).toFixed(2),
  avgSchemaChars: Math.round(mean(rows.map(r => r.chars))),
  byKind: Object.fromEntries(['D', 'S', 'E'].map(k => [k, +pct(rows.filter(r => r.task.kind === k).map(r => r.complete)).toFixed(1)])),
});

const results = {
  generatedAt: new Date().toISOString(),
  config: { k: K, trials: TRIALS, epochs: EPOCHS, hydradb: 'v0.4.0 graph-node, local object store', catalogTools: TOOLS.length, realMimirTools: TOOLS.filter(t => t.real).length, skills: SKILLS.length, tasks: TASKS.length, train: trainTasks.length, test: testTasks.length, allToolsSchemaChars: ALL_SCHEMA_CHARS },
};

// ---------- baselines ----------
log('baselines');
const bmTools = bm25Tools();
const bmSkills = bm25WithSkills();
results.baselines = {
  preloadAll: { complete: 100, recall: 100, avgTools: TOOLS.length, avgSchemaChars: ALL_SCHEMA_CHARS, note: 'every tool definition sent on every call' },
  bm25Tools: summarize(evalBm25(bmTools, testTasks, K)),
  bm25ToolsAndSkills: summarize(evalBm25(bmSkills, testTasks, K)),
};

// ---------- learning curves: 5 independent trials, different training order ----------
const curves = [];
let selectionsGraphCold = null;
let selectionsGraphLearned = null;
let trial0Graph = null;
for (let trial = 0; trial < TRIALS; trial++) {
  const ns = `trial${trial}-${RUN}`;
  log(`trial ${trial}: seeding`);
  const g = await freshGraph(ns);
  const stats = { epoch: [], test: [], train: [], testByKind: [], writes: 0 };
  const record = async epoch => {
    const test = await evalGraph(g, testTasks, ns);
    const train = await evalGraph(g, trainTasks, ns);
    stats.epoch.push(epoch);
    stats.test.push(summarize(test));
    stats.train.push(summarize(train));
    if (trial === 0 && epoch === 0) selectionsGraphCold = Object.fromEntries(test.map(r => [r.task.id, r.sel]));
    return test;
  };
  await record(0);
  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    setNamespace(ns);
    for (const t of shuffle(trainTasks, 1000 * trial + epoch)) {
      const r = await g.retrieve(t.text, { k: K });
      const w = await g.learn({ text: t.text, used: t.tools, retrieved: r.tools.map(x => x.id) });
      stats.writes += w.reinforced + w.created + w.removed + w.entityLinks;
    }
    const test = await record(epoch);
    log(`trial ${trial} epoch ${epoch}: test complete ${stats.test.at(-1).complete}%  train ${stats.train.at(-1).complete}%`);
    if (trial === 0 && epoch === EPOCHS) {
      selectionsGraphLearned = Object.fromEntries(test.map(r => [r.task.id, r.sel]));
      trial0Graph = { g, ns, rows: test };
    }
  }
  curves.push(stats);
}
const epochs = curves[0].epoch;
results.learningCurve = {
  epochs,
  testCompleteMean: epochs.map((_, i) => +mean(curves.map(c => c.test[i].complete)).toFixed(1)),
  testCompleteSd: epochs.map((_, i) => +sd(curves.map(c => c.test[i].complete)).toFixed(1)),
  testRecallMean: epochs.map((_, i) => +mean(curves.map(c => c.test[i].recall)).toFixed(1)),
  trainCompleteMean: epochs.map((_, i) => +mean(curves.map(c => c.train[i].complete)).toFixed(1)),
  byKindMean: Object.fromEntries(['D', 'S', 'E'].map(k => [k, epochs.map((_, i) => +mean(curves.map(c => c.test[i].byKind[k])).toFixed(1))])),
  avgToolsLoaded: epochs.map((_, i) => +mean(curves.map(c => c.test[i].avgTools)).toFixed(2)),
  edgeWritesPerTrial: Math.round(mean(curves.map(c => c.writes))),
  perTrial: curves.map(c => c.test.map(t => t.complete)),
};

// ---------- confidence: coverage vs accuracy, and the fallback design ----------
{
  const { g, ns, rows } = trial0Graph;
  const sweep = [0, 0.3, 0.6, 1, 1.5, 2].map(th => {
    const conf = rows.filter(r => r.top >= th);
    return { threshold: th, coveragePct: +(100 * conf.length / rows.length).toFixed(1), completeWhenConfident: conf.length ? +pct(conf.map(r => r.complete)).toFixed(1) : null };
  });
  const builtinIds = TOOLS.filter(t => t.real).map(t => t.id);
  const withFallback = rows.map(r => {
    const sel = r.top >= 1 ? r.sel : [...new Set([...r.sel, ...builtinIds])];
    return { ...score(sel, r.task.tools), chars: schemaChars(sel) };
  });
  results.confidence = { sweep, fallbackThreshold: 1, fallbackSetIs: 'graph picks plus Mimir built-ins (19 tools)', withFallback: { complete: +pct(withFallback.map(r => r.complete)).toFixed(1), avgSchemaChars: Math.round(mean(withFallback.map(r => r.chars))) } };
  void g;
  void ns;
}

// ---------- drift: tools the graph has never seen ----------
{
  log('drift');
  const ns = `drift-${RUN}`;
  const g = await freshGraph(ns);
  const NEW = [
    { id: 'tiktok__post_video', server: 'tiktok', description: 'Publish a short video to TikTok with a caption', params: ['video', 'caption'], phrasings: ['Put the clip on TikTok with a funny caption', 'Publish this short video to our TikTok account', 'Upload the reel to TikTok'] },
    { id: 'quickbooks__send_estimate', server: 'quickbooks', description: 'Send a price estimate (quote) to a customer from QuickBooks', params: ['customer', 'items'], phrasings: ['Send the customer an estimate for the kitchen job', 'Email a price quote from QuickBooks to Mr Patel', 'Create and send an estimate for the repair'] },
    { id: 'calendly__create_booking_link', server: 'calendly', description: 'Create a Calendly booking link for a meeting type', params: ['type'], phrasings: ['Make me a booking link people can use to book a call', 'Create a Calendly link for 30 minute intro calls', 'Generate a scheduling link for demos'] },
    { id: 'mailchimp__send_campaign', server: 'mailchimp', description: 'Send a newsletter campaign to a Mailchimp audience', params: ['audience', 'subject'], phrasings: ['Send the November newsletter to all subscribers', 'Blast the sale announcement to the mailing list', 'Launch the email campaign to the audience'] },
    { id: 'zendesk__merge_tickets', server: 'zendesk', description: 'Merge duplicate Zendesk support tickets into one', params: ['source', 'target'], phrasings: ['Merge the duplicate support tickets from this customer', 'Combine these two Zendesk tickets', 'Fold the repeated help requests into one'] },
  ];
  const pre = { cold: [], afterOne: [], afterTwo: [] };
  for (const n of NEW) await g.addTool({ id: n.id, server: n.server, description: n.description });
  setNamespace(ns);
  const evalNew = async p => {
    const rows = [];
    for (const n of NEW) {
      const r = await g.retrieve(n.phrasings[p], { k: K });
      rows.push(score(r.tools.map(x => x.id), [n.id]).complete ? 1 : 0);
    }
    return pct(rows);
  };
  pre.cold = await evalNew(2); // held-out wording, tool only known from its description
  for (const n of NEW) {
    const r = await g.retrieve(n.phrasings[0], { k: K });
    await g.learn({ text: n.phrasings[0], used: [n.id], retrieved: r.tools.map(x => x.id) });
  }
  pre.afterOne = await evalNew(2);
  for (const n of NEW) {
    const r = await g.retrieve(n.phrasings[1], { k: K });
    await g.learn({ text: n.phrasings[1], used: [n.id], retrieved: r.tools.map(x => x.id) });
  }
  pre.afterTwo = await evalNew(2);
  results.drift = { newTools: NEW.length, heldOutCompletePct: { onlyDescription: +pre.cold.toFixed(1), afterOneExample: +pre.afterOne.toFixed(1), afterTwoExamples: +pre.afterTwo.toFixed(1) }, note: 'tools added at run time, no rebuild; wording of the test task never appeared in training' };
}

// ---------- outputs ----------
const methodsSel = (fn) => Object.fromEntries(testTasks.map(t => [t.id, fn(t)]));
const selections = {
  'BM25 on tools': methodsSel(t => bmTools.search(t.text, K).map(x => x.id)),
  'BM25 on tools + skills': methodsSel(t => bmSkills.search(t.text, K).map(x => x.id)),
  'Graph, cold start': selectionsGraphCold,
  'Graph, after learning': selectionsGraphLearned,
};
fs.writeFileSync(new URL('selections.json', OUT), JSON.stringify(selections));
fs.writeFileSync(new URL('results.json', OUT), JSON.stringify(results, null, 1));
results.hydraRequests = store.requests;
console.log(JSON.stringify({ baselines: results.baselines, learningCurve: results.learningCurve, confidence: results.confidence, drift: results.drift }, null, 1));
void nodeId;
