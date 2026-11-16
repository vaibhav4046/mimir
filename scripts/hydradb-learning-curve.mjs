/**
 * Reproducible, genuine self-hosted-HydraDB feedback-curve experiment.
 *
 * Labels are synthetic and frozen in this file BEFORE any graph runs.
 * They are NOT customer annotations or model answer accuracy.
 * Each correction writes an actual SUPPRESSES edge; held-out questions
 * measure whether that change generalizes to different wording.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { HydraContextRouter, capabilityForTask } from '../daemon/hydradb-context.mjs';

if (!process.env.MIMIR_HYDRADB_TOKEN) {
  console.error('No real OSS HydraDB token supplied. Aborting rather than simulating an improvement curve.');
  process.exit(2);
}
const definitions = [
  ['browser_search', 'Search web sources and headlines'],
  ['browser_open', 'Browse an entire webpage in a browser'],
  ['web_fetch', 'Retrieve web page content'],
  ['knowledge_search', 'Search knowledge base and source documents'],
  ['fs_read', 'Read local workspace file'],
  ['fs_write', 'Write local workspace file'],
  ['memory_read', 'Recall saved memory facts'],
  ['memory_save', 'Remember and save a memory'],
  ['shell_exec', 'Execute code in terminal shell'],
  ['git_commit', 'Commit code with Git'],
  ['image_render', 'Render an image'],
  ['video_create', 'Generate a video'],
  ['foundry_create', 'Generate creative images and documents'],
  ['email_send', 'Send email to a recipient'],
  ['slack_post', 'Post a message on Slack'],
  ['subagent_loop', 'Delegate work to a specialist team agent'],
  ['council_convene', 'Convene a team agent council'],
  ['routine_create', 'Schedule automated workflow routines'],
];
const schemas = definitions.map(([name, description])=>({
  type:'function', function:{name,description,parameters:{type:'object',properties:{}}},
}));
// Frozen small, *synthetic* relevance labels. Each category is disjoint;
// all held-out prompts are unseen by the feedback updater.
const groups = [
  {
    category:'research',
    trainingTask:'search web headlines only',
    heldoutTask:'research web headlines only',
    expected:['browser_search'],
  },
  {
    category:'memory',
    trainingTask:'recall my previous memory facts',
    heldoutTask:'remembered memory recall of a prior fact',
    expected:['memory_read'],
  },
  {
    category:'code',
    trainingTask:'execute code in terminal shell',
    heldoutTask:'run a shell program',
    expected:['shell_exec'],
  },
  {
    category:'creative',
    trainingTask:'render an image',
    heldoutTask:'generate an image',
    expected:['image_render'],
  },
  {
    category:'collaborate',
    trainingTask:'delegate this to an agent',
    heldoutTask:'ask a subagent to handle this',
    expected:['subagent_loop'],
  },
  {
    category:'communicate',
    trainingTask:'send an email',
    heldoutTask:'email a recipient',
    expected:['email_send'],
  },
];
const router = new HydraContextRouter();
const scope = 'mimir-oss-learning-curve-20261116-frozen-v1';
function benchmarkStats(records) {
  const tp=records.reduce((a,r)=>a+r.selected.filter(x=>r.expected.includes(x)).length,0);
  const chosen=records.reduce((a,r)=>a+r.selected.length,0);
  const expected=records.reduce((a,r)=>a+r.expected.length,0);
  const allBytes=records.reduce((a,r)=>a+r.fullBytes,0);
  const chosenBytes=records.reduce((a,r)=>a+r.chosenBytes,0);
  const durations=records.map(r=>r.durationMs).sort((a,b)=>a-b);
  return {
    microPrecision:chosen?tp/chosen:0,
    microRecall:expected?tp/expected:0,
    completeToolCoverage:records.filter(r=>r.expected.every(x=>r.selected.includes(x))).length,
    tasks:records.length,
    graphToolContextBytes:chosenBytes,
    fullRegistryContextBytes:allBytes,
    contextBytesReductionPct:allBytes?100*(1-chosenBytes/allBytes):0,
    p50RoutingMs:durations[Math.floor(durations.length*0.50)],
    p95RoutingMs:durations[Math.ceil(durations.length*0.95)-1],
  };
}
async function evaluate(stage) {
  const records=[];
  for(const g of groups){
    const start=performance.now();
    const res=await router.route(g.heldoutTask,schemas,{scope});
    records.push({
      category:g.category, task:g.heldoutTask, expected:g.expected,
      selected:res.tools.map(x=>x.function.name),
      fullBytes:Buffer.byteLength(JSON.stringify(schemas)),
      chosenBytes:Buffer.byteLength(JSON.stringify(res.tools)),
      trace:res.trace,
      durationMs:Number((performance.now()-start).toFixed(3)),
    });
  }
  return {stage,...benchmarkStats(records),records};
}
async function teach(g){
  const intents=capabilityForTask(g.trainingTask);
  if(intents.length!==1||intents[0]!==g.category) {
    throw new Error('Train fixture must match only intended capability: '+g.category+' -> '+intents);
  }
  const selected=(await router.route(g.trainingTask,schemas,{scope})).tools.map(x=>x.function.name);
  const irrelevant=selected.filter(name=>!g.expected.includes(name));
  for(const toolName of irrelevant) {
    await router.teach({scope,capability:g.category,toolName,relevant:false});
  }
  return {category:g.category,trainingTask:g.trainingTask,excludedToolNames:irrelevant};
}
const timeline=[await evaluate('round-0-frozen-baseline-graph')];
const trainingEvents=[];
for(let i=0;i<groups.length;i+=2){
  for(const g of groups.slice(i,i+2)) trainingEvents.push(await teach(g));
  timeline.push(await evaluate('round-'+(i/2+1)+'-real-feedback-writes'));
}
const baseline = {
  fullRegistryBytesPerTask:Buffer.byteLength(JSON.stringify(schemas)),
  fullRegistryMicroPrecision:groups.reduce((a,g)=>a+g.expected.length,0)/(schemas.length*groups.length),
  fullRegistryMicroRecall:1,
};
const output={
  type:'real-hydradb-frozen-synthetic-feedback-evaluation',
  time:new Date().toISOString(),
  server:process.env.MIMIR_HYDRADB_URL||'http://127.0.0.1:8443',
  scope, schemasCount:schemas.length, frozenLabels:groups,
  baseline, trainingEvents, timeline,
  limitations:[
    'Synthetic, researcher-authored tool relevance labels, not customer feedback',
    'Measures tool relevance, not end-to-end agent answer success or model accuracy',
    'Small six-class held-out paraphrase set, not statistically representative',
    'Learning is verified feedback edge suppression, not unsupervised self-correction',
    'Context measured in JSON bytes, not tokens, and no inference cost measurement',
    'Scope is persistent across runs: a fresh namespace/data store is required for a clean baseline',
  ],
};
const dir=path.join(process.cwd(),'artifacts','hydradb');
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'learning-curve-'+Date.now()+'.json');
fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({file,baseline,curve:timeline.map(t=>({
  stage:t.stage,precision:t.microPrecision,recall:t.microRecall,
  contextBytesReductionPct:t.contextBytesReductionPct,p95RoutingMs:t.p95RoutingMs,
})),trainingEvents},null,2));
