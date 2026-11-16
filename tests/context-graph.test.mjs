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
const make = (store, enabled = true) => new AgentContextGraph({ store, namespace: 'test', getSettings: () => ({ contextGraph: { enabled } }) });
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
