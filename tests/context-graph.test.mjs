import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentContextGraph } from '../daemon/context-graph.mjs';
import { MemoryStore } from '../contextgraph/src/store-memory.mjs';
import { ContextGraph } from '../contextgraph/src/graph.mjs';
import { setNamespace } from '../contextgraph/src/text.mjs';
import { TOOLS, toSchema } from '../contextgraph/data/catalog.mjs';
import { SKILLS, ENTITIES } from '../contextgraph/data/skills.mjs';
import { TASKS } from '../contextgraph/data/tasks.mjs';

const schemas = TOOLS.slice(0, 120).map(toSchema);
const make = (store, enabled = true) => new AgentContextGraph({ store, namespace: 'test', getSettings: () => ({ contextGraph: { enabled, initBudgetMs: 60_000 } }) });
const names = tools => tools.map(t => t.function.name);

test('catalog and benchmark labels are consistent', () => {
  const ids = new Set(TOOLS.map(t => t.id));
  for (const t of TASKS) for (const r of t.tools) assert.ok(ids.has(r), `${t.id} needs unknown tool ${r}`);
  assert.equal(new Set(TASKS.map(t => t.id)).size, TASKS.length, 'task ids are unique');
  for (const [, , req] of SKILLS) for (const r of req) assert.ok(ids.has(r), `skill needs unknown tool ${r}`);
  assert.ok(ENTITIES.length >= 5);
  assert.ok(TOOLS.length >= 250 && TOOLS.filter(t => t.real).length === 19);
});

test('it offers a handful of tools instead of all of them, and the right ones', async () => {
  const cg = make(new MemoryStore());
  const pulled = await cg.select('Send an email to my supplier asking for a quote', schemas);
  assert.ok(pulled, 'graph was confident');
  assert.ok(pulled.length <= 12 && pulled.length >= 1, `offered ${pulled.length}`);
  assert.ok(names(pulled).includes('gmail__send_email'), names(pulled).join(','));
  assert.equal(cg.status().lastPull.of, 120);
});

test('disabled, short lists and unsure requests leave the tool list alone', async () => {
  assert.equal(await make(new MemoryStore(), false).select('send an email please', schemas), null);
  assert.equal(await make(new MemoryStore()).select('send an email please', schemas.slice(0, 5)), null, 'few tools: no point');
  assert.equal(await make(new MemoryStore()).select('zzzz qqqq xxxx', schemas), null, 'nothing matched: fall back');
  assert.equal(await make(new MemoryStore()).select('hi', schemas), null);
});

test('it learns from the tools that really ran, and a restart keeps what it learned', async () => {
  const store = new MemoryStore();
  const cg = make(store);
  const text = 'Chase the rent from my tenant';
  const before = await cg.select(text, schemas);
  assert.ok(!before || !names(before).includes('calendar__create_event'));
  await cg.record({ userText: text, offered: before ? names(before) : [], turnMessages: [{ role: 'tool', toolName: 'calendar__create_event', content: 'sent' }, { role: 'tool', toolName: 'slack__post_message', content: 'ERROR: nope' }, { role: 'tool', toolName: 'gmail__send_email', approved: false, content: 'denied' }] });
  const after = await cg.select(text, schemas);
  assert.ok(after && names(after).includes('calendar__create_event'), 'learned the tool that ran');
  assert.ok(!names(after).includes('slack__post_message'), 'a failed tool is not learned');

  const restarted = make(store); // same store, new process
  const again = await restarted.select(text, schemas);
  assert.ok(again && names(again).includes('calendar__create_event'), 'learning survived the restart');
  const edgesBefore = (await store.stats()).edges;
  await restarted.select('Send an email to my supplier', schemas);
  assert.equal((await store.stats()).edges, edgesBefore, 'tools already in the graph are not added twice');
});

test('with no HydraDB running it uses an in-process graph, unless HydraDB is required', async () => {
  const dead = 'http://127.0.0.1:1'; // nothing listens here
  const mk = store => new AgentContextGraph({ namespace: 'test-fallback', getSettings: () => ({ contextGraph: { enabled: true, initBudgetMs: 60_000, url: dead, ...(store ? { store } : {}) } }) });
  const auto = mk();
  const pulled = await auto.select('Send an email to my supplier asking for a quote', schemas);
  assert.ok(pulled && names(pulled).includes('gmail__send_email'), 'still narrows the list without HydraDB');
  assert.equal(auto.status().store, 'memory');
  const strict = mk('hydradb');
  assert.equal(await strict.select('Send an email to my supplier asking for a quote', schemas), null, 'required HydraDB missing: fails open');
  assert.match(strict.status().lastPull.error, /./);
  const forced = mk('memory');
  assert.ok(await forced.select('Send an email to my supplier asking for a quote', schemas));
  assert.equal(forced.status().store, 'memory');
});

test('a turn never waits for setup: a slow graph is skipped once, then used when it is ready', async () => {
  const slow = new MemoryStore();
  const realInit = slow.init.bind(slow);
  slow.init = async () => { await new Promise(r => setTimeout(r, 300)); await realInit(); };
  const cg = new AgentContextGraph({ store: slow, namespace: 'test-slow', getSettings: () => ({ contextGraph: { enabled: true, initBudgetMs: 20 } }) });
  const t0 = performance.now();
  assert.equal(await cg.select('Send an email to my supplier asking for a quote', schemas), null, 'first turn runs on the full list');
  assert.ok(performance.now() - t0 < 250, 'did not wait for setup');
  assert.equal(cg.status().failures, 0, 'being slow is not a failure');
  const deadline = Date.now() + 60_000;
  let pulled = null;
  while (!pulled && Date.now() < deadline) { await new Promise(r => setTimeout(r, 100)); pulled = await cg.select('Send an email to my supplier asking for a quote', schemas); }
  assert.ok(pulled && names(pulled).includes('gmail__send_email'), 'used once ready');
});

test('it fails open: a broken store never breaks a turn, and it stops trying after repeated failures', async () => {
  const broken = new MemoryStore();
  broken.outMany = async () => {
    throw new Error('HydraDB down');
  };
  const cg = make(broken);
  for (let i = 0; i < 3; i++) assert.equal(await cg.select('send an email to the team', schemas), null);
  assert.match(cg.status().lastPull.error, /HydraDB down/);
  assert.equal(cg.enabled, false, 'gave up after 3 failures');
  assert.equal(await cg.select('send an email to the team', schemas), null);
  await cg.record({ userText: 'x', turnMessages: [], offered: [] }); // must not throw
});

test('entities the agent learned steer tools to the right system', async () => {
  const store = new MemoryStore();
  setNamespace('ent');
  const g = new ContextGraph(store, { k: 6 });
  await g.seed({ tools: TOOLS, skills: SKILLS, servers: [...new Set(TOOLS.map(t => t.server))] });
  await g.registerEntity('Northwind');
  const ask = 'Show the tickets for Northwind';
  const first = await g.retrieve(ask);
  await g.learn({ text: ask, used: ['linear__search_tickets'], retrieved: first.tools.map(t => t.id) });
  const second = await g.retrieve('Any new tickets on Northwind?');
  assert.equal(second.tools[0].id.startsWith('linear__'), true, second.tools.map(t => t.id).join(','));
  assert.ok(second.tools[0].why.some(w => w.kind === 'entity'), 'explained by the entity link');
  assert.ok(second.trace.some(e => e.rel === 'RESOLVES_TO'), 'trace shows the link');
});

test('after giving up it tries again once a minute has passed, so a HydraDB restart heals it', async () => {
  const flaky = new MemoryStore();
  const realOut = flaky.outMany.bind(flaky);
  let down = true;
  flaky.outMany = async (...a) => {
    if (down) throw new Error('HydraDB down');
    return realOut(...a);
  };
  const cg = make(flaky);
  for (let i = 0; i < 3; i++) await cg.select('send an email to the team', schemas);
  assert.equal(cg.enabled, false);
  down = false;
  assert.equal(cg.enabled, false, 'still cooling down');
  cg.lastFailureAt = Date.now() - 61_000;
  assert.equal(cg.enabled, true, 'cooldown over');
  const pulled = await cg.select('Send an email to my supplier asking for a quote', schemas);
  assert.ok(pulled && pulled.length >= 1, 'works again after HydraDB came back');
  assert.equal(cg.status().failures, 0);
});

test('the HydraDB token is never an empty string (that made every call unauthenticated)', async () => {
  const { HydraStore } = await import('../contextgraph/src/store-hydradb.mjs');
  assert.ok(new HydraStore({ token: undefined }).token.length >= 32);
  const src = (await import('node:fs')).readFileSync(new URL('../daemon/context-graph.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /MIMIR_CONTEXT_GRAPH_TOKEN \|\| ''/);
});

test('live-embedded neighbours help a new word next to known ones, but never make nonsense look confident', async () => {
  setNamespace('embed-guard');
  const g = new ContextGraph(new MemoryStore(), { k: 6 });
  await g.seed({ tools: TOOLS, skills: [], servers: [] });
  // A stand-in embedder that links every unknown word to the word "email" (the worst case for false confidence).
  g.embedUnknown = async words => new Map(words.map(w => [w, [['email', 0.9]]]));
  const nonsense = await g.retrieve('zzzz qqqq xxxx');
  assert.equal(nonsense.confident, false, 'only live-embedded evidence and a weak score: fall back to every tool');
  const mixed = await g.retrieve('Send an email to the blorbwave team');
  assert.equal(mixed.confident, true, 'a known word plus a new word still works');
  assert.ok(mixed.tools.some(t => /email|mail/.test(t.id)), mixed.tools.map(t => t.id).join(','));
  g.embedUnknown = async () => {
    throw new Error('ollama down');
  };
  const survived = await g.retrieve('Send an email to the blorbwave team');
  assert.equal(survived.confident, true, 'a throwing embedder just means no extra links; retrieval still works');
});

test('a turn where the graph was unsure teaches only what worked, never "these tools lost"', async () => {
  const cg = make(new MemoryStore());
  const learned = [];
  await cg.select('Send an email to my supplier asking for a quote', schemas); // initialise the graph
  const realLearn = cg.graph.learn.bind(cg.graph);
  cg.graph.learn = async arg => {
    learned.push(arg);
    return realLearn(arg);
  };
  const turn = [{ role: 'tool', toolName: 'gmail__send_email', content: 'ok', approved: true }];
  await cg.select('zzzz qqqq xxxx', schemas); // unsure: the model gets every tool
  await cg.record({ userText: 'zzzz qqqq xxxx', turnMessages: turn, offered: schemas.map(t => t.function.name) });
  assert.deepEqual(learned.at(-1).retrieved, [], 'full-list turn: nothing counts against the tools that were not picked');
  await cg.select('Send an email to my supplier asking for a quote', schemas); // confident: a narrowed list
  await cg.record({ userText: 'Send an email to my supplier asking for a quote', turnMessages: turn, offered: ['gmail__send_email', 'gmail__search_email'] });
  assert.deepEqual(learned.at(-1).retrieved, ['gmail__send_email', 'gmail__search_email'], 'narrowed turn: offered-but-unused is real evidence');
});
