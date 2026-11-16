import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HydraContextRouter, capabilityForTask, capabilitiesForTool,
} from '../daemon/hydradb-context.mjs';

function mockHydra() {
  const names = new Map();
  const edges = new Map();
  const suppressed = new Map();
  const calls = [];
  const fetchImpl = async (_url, opts) => {
    const { query, parameters, cell_id } = JSON.parse(opts.body);
    calls.push({ query, parameters, cell_id, headers: opts.headers });
    assert.equal(cell_id, 'cell-0');
    let columns = [], rows = [];
    if (query.includes('SET n:Capability') || query.includes('SET n:Tool')) {
      for (const row of parameters.rows) names.set(row.id, row.name);
    } else if (query.includes('CREATE (a {id: row.src})-[:ROUTES_TO]->(b {id: row.dst})')) {
      for (const { src, dst } of parameters.rows) {
        const out = edges.get(src) || new Set();
        out.add(dst);
        edges.set(src, out);
      }
    } else if (query.includes('MATCH (c {id: $id})-[:ROUTES_TO]->(t)')) {
      columns = ['name'];
      rows = [...(edges.get(parameters.id) || [])].map(id => [{ type: 'string', value: names.get(id) }]);
    } else if (query.includes('MATCH (c {id: $id})-[:SUPPRESSES]->(t)')) {
      columns = ['name'];
      rows = [...(suppressed.get(parameters.id) || [])].map(id => [{ type: 'string', value: names.get(id) }]);
    } else if (query.includes('MERGE (a:Capability {id: $src})-[:SUPPRESSES]->(b:Tool {id: $dst})')) {
      const out = suppressed.get(parameters.src) || new Set();
      out.add(parameters.dst);
      suppressed.set(parameters.src, out);
    } else if (query.includes('MATCH (a {id: $src})-[r:SUPPRESSES]->(b {id: $dst}) DELETE r')) {
      suppressed.get(parameters.src)?.delete(parameters.dst);
    } else {
      throw Error('Unexpected query: ' + query);
    }
    return { ok: true, json: async () => ({ columns, rows }) };
  };
  return { fetchImpl, calls, edges };
}
function tool(name, description) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties: {} } } };
}
const tools = [
  tool('browser_search', 'Search the web for reliable source material'),
  tool('knowledge_search', 'Search research evidence in a knowledge base'),
  tool('browser_open', 'Open a browser page for analysis'),
  tool('fs_read', 'Read workspace file contents'),
  tool('fs_write', 'Write and edit workspace files'),
  tool('memory_read', 'Recall saved facts from agent memory'),
  tool('memory_save', 'Remember durable user information'),
  tool('shell_exec', 'Execute terminal shell commands'),
  tool('subagent_loop', 'Delegate work to specialist team agents'),
];

test('intent classification is deterministic and bounded', () => {
  assert.deepEqual(capabilityForTask('search web'), ['research']);
  assert.deepEqual(capabilityForTask('hello'), ['general']);
  assert.ok(capabilitiesForTool(tools[0]).includes('research'));
  assert.ok(capabilitiesForTool(tools[2]).includes('files'));
});

test('route uses real HydraDB-shaped write and graph traversal queries', async () => {
  const { fetchImpl, calls } = mockHydra();
  const router = new HydraContextRouter({ token: 'test-token', fetchImpl });
  const result = await router.route('search the web for a source', tools, { scope: 'tenant-1' });
  assert.equal(result.trace.status, 'hydradb-traversal');
  assert.ok(result.trace.after < result.trace.before);
  assert.ok(result.tools.some(x => x.function.name === 'browser_search'));
  assert.ok(calls.some(x => x.query.includes('UNWIND $rows AS row')));
  assert.ok(calls.some(x => x.query.includes('MATCH (c {id: $id})-[:ROUTES_TO]->(t)')));
  assert.ok(calls.every(x => x.headers.Authorization === 'Bearer test-token'));
});

test('graph cannot inject a tool outside the authorised schema list', async () => {
  const { fetchImpl } = mockHydra();
  const router = new HydraContextRouter({ token: 'test-token', fetchImpl });
  const eligible = [tool('fs_read', 'Read a workspace file')];
  const result = await router.route('read a file', eligible, { scope: 'tenant-2' });
  assert.deepEqual(result.tools.map(t => t.function.name), ['fs_read']);
});

test('scope separation yields distinct graph IDs', async () => {
  const graph = mockHydra();
  const router = new HydraContextRouter({ token: 'test-token', fetchImpl: graph.fetchImpl });
  await router.route('search web', tools, { scope: 'workspace-a' });
  const q1 = graph.calls.findLast(c => c.query.includes('MATCH (c {id: $id})'));
  await router.route('search web', tools, { scope: 'workspace-b' });
  const q2 = graph.calls.findLast(c => c.query.includes('MATCH (c {id: $id})'));
  assert.notEqual(q1.parameters.id, q2.parameters.id);
});

test('degraded graph response cannot be confused with a verified result', async () => {
  const badFetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'unauthorized' } }) });
  const router = new HydraContextRouter({ token: 'wrong-token', fetchImpl: badFetch });
  await assert.rejects(() => router.route('research', tools), /HydraDB query failure/);
});

test('remote plaintext HydraDB is rejected', () => {
  assert.throws(() => new HydraContextRouter({ url: 'http://graph.example.com:8443', token: 'x' }), /HTTPS/);
});

test('feedback persists graph suppression without removing available permissions', async () => {
  const graph = mockHydra();
  const router = new HydraContextRouter({ token: 'test-token', fetchImpl: graph.fetchImpl });
  const before = await router.route('research web sources', tools, { scope: 'feedback-a' });
  assert.ok(before.tools.some(t => t.function.name === 'browser_search'));
  await router.teach({ scope: 'feedback-a', capability: 'research', toolName: 'browser_search', relevant: false });
  const after = await router.route('research web sources', tools, { scope: 'feedback-a' });
  assert.ok(!after.tools.some(t => t.function.name === 'browser_search'), JSON.stringify({ trace: after.trace, selected: after.tools.map(t => t.function.name), calls: graph.calls.slice(-5) }));
  assert.ok(after.tools.some(t => t.function.name === 'knowledge_search'));
  await router.teach({ scope: 'feedback-a', capability: 'research', toolName: 'browser_search', relevant: true });
  const restored = await router.route('research web sources', tools, { scope: 'feedback-a' });
  assert.ok(restored.tools.some(t => t.function.name === 'browser_search'));
});
