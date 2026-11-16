// "Your team's own words": the graph meets private jargon it cannot know ("run the pulse"),
// learns it from one or two examples, and must not forget or damage anything else.
//   node bench/jargon.mjs   (HydraDB; merges into results/results.json)
import fs from 'node:fs';
import { HydraStore } from '../src/store-hydradb.mjs';
import { setNamespace } from '../src/text.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { SIMILAR, TOOLS, SKILLS, SERVERS, ENTITY_NAMES, testTasks, score, pct, toolIdSet, bm25WithSkills, EMBEDDER } from './lib.mjs';

// [jargon, tools, [phrasing 0, phrasing 1, held-out phrasing 2]]
const JARGON = [
  ['bluebird', ['social__post_tweet'], ['Send out the bluebird about the sale', 'Do a bluebird for tomorrow\'s launch', 'Bluebird: new menu is live']],
  ['mothership', ['github__list_pull_requests', 'github__get_pull_request_diff'], ['Check the mothership', 'Anything waiting on the mothership?', 'Mothership review time']],
  ['greenlight', ['vercel__deploy_project'], ['Greenlight the storefront', 'Give the blog a greenlight', 'Greenlight it please']],
  ['pennywise', ['accounting__get_profit_loss', 'accounting__list_invoices'], ['Run pennywise for October', 'Pennywise on the Q3 numbers', 'Do pennywise before the meeting']],
  ['huddle', ['calendar__find_free_time', 'zoom__create_meeting'], ['Set up a huddle with Anna and Joe', 'Huddle for the whole design team', 'Need a huddle about pricing']],
  ['stockcheck', ['shopify__update_inventory', 'shopify__list_products'], ['Stockcheck on the mugs', 'Quick stockcheck for tote bags', 'Do the stockcheck']],
  ['zeroing', ['gmail__list_unread', 'gmail__archive_email'], ['Do the zeroing', 'Zeroing time for my mail', 'Start zeroing']],
  ['pulse', ['analytics__get_site_traffic', 'analytics__get_conversion_funnel'], ['Give me the pulse', 'Weekly pulse of the site', 'Pulse on checkout']],
  ['lighthouse', ['sentry__list_errors', 'aws__cloudwatch_get_logs'], ['Lighthouse the app', 'Lighthouse after the deploy', 'Run a lighthouse on prod']],
  ['scribe', ['zoom__get_transcript', 'notion__create_page'], ['Scribe yesterday\'s call', 'Scribe the standup', 'Scribe it']],
];
for (const [, tools] of JARGON) for (const t of tools) if (!toolIdSet.has(t)) throw new Error(`unknown tool ${t}`);

const store = new HydraStore({ url: process.env.HYDRA_URL || 'http://127.0.0.1:18443' });
await store.init();
const ns = `jargon-${Date.now().toString(36)}`;
setNamespace(ns);
const g = new ContextGraph(store, { k: 6 });
await g.seed({ tools: TOOLS, skills: SKILLS, servers: SERVERS.map(s => s.name) });
for (const name of ENTITY_NAMES) await g.registerEntity(name);
await g.loadSimilar(SIMILAR);
if (EMBEDDER) g.embedUnknown = EMBEDDER;

const evalHeldOut = async () => {
  setNamespace(ns);
  const rows = [];
  for (const [, tools, ph] of JARGON) rows.push(score((await g.retrieve(ph[2], { k: 6 })).tools.map(x => x.id), tools).complete ? 1 : 0);
  return +pct(rows).toFixed(1);
};
const evalRegression = async () => {
  setNamespace(ns);
  const rows = [];
  for (const t of testTasks) rows.push(score((await g.retrieve(t.text, { k: 6 })).tools.map(x => x.id), t.tools).complete ? 1 : 0);
  return +pct(rows).toFixed(1);
};

const out = { terms: JARGON.map(j => j[0]), tasks: JARGON.length, regressionBefore: await evalRegression(), heldOut: { cold: await evalHeldOut() } };
for (const p of [0, 1]) {
  for (const [, tools, ph] of JARGON) {
    setNamespace(ns);
    const r = await g.retrieve(ph[p], { k: 6 });
    await g.learn({ text: ph[p], used: tools, retrieved: r.tools.map(x => x.id) });
  }
  out.heldOut[p === 0 ? 'afterOneExample' : 'afterTwoExamples'] = await evalHeldOut();
}
out.regressionAfter = await evalRegression();
const bm = bm25WithSkills();
out.bm25HeldOut = +pct(JARGON.map(([, tools, ph]) => (score(bm.search(ph[2], 6).map(x => x.id), tools).complete ? 1 : 0))).toFixed(1);
const f = new URL('../results/results.json', import.meta.url);
const R = JSON.parse(fs.readFileSync(f, 'utf8'));
R.jargon = out;
fs.writeFileSync(f, JSON.stringify(R, null, 1));
console.log(JSON.stringify(out));
