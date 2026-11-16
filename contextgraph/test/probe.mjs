// Probes the HydraDB dialect shapes the store depends on. Run against a live node.
import { HydraStore, cell } from '../src/store-hydradb.mjs';
const s = new HydraStore({ url: process.env.HYDRA_URL || 'http://127.0.0.1:18443' });
await s.init();
const show = async (name, fn) => {
  try {
    const r = await fn();
    console.log(`OK   ${name}`, r === undefined ? '' : JSON.stringify(r).slice(0, 220));
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.slice(0, 200)}`);
  }
};
const ids = { t1: 910001, t2: 910002, tool: 910003, tool2: 910004 };
await show('node batch with label + props', () => s.upsertNodes([
  { id: ids.t1, label: 'Term', props: { name: 'invoice', df: 3 } },
  { id: ids.t2, label: 'Term', props: { name: 'bill', df: 2 } },
  { id: ids.tool, label: 'Tool', props: { name: 'stripe__create_invoice' } },
  { id: ids.tool2, label: 'Tool', props: { name: 'accounting__list_invoices' } },
]));
await show('weighted edge CREATE', () => s.q(`CREATE (a {id: $s})-[:MENTIONS {w: $w}]->(b {id: $d})`, { s: ids.t1, d: ids.tool, w: 0.5 }));
await show('weighted edge CREATE #2', () => s.q(`CREATE (a {id: $s})-[:MENTIONS {w: $w}]->(b {id: $d})`, { s: ids.t1, d: ids.tool2, w: 0.25 }));
await show('read with r.w', async () => (await s.q(`MATCH (a {id: ${ids.t1}})-[r:MENTIONS]->(b) RETURN a.id AS src, b.id AS dst, r.w AS w`)).rows.map(r => r.map(cell)));
await show('SET r.w on existing edge', () => s.q(`MATCH (a {id: $s})-[r:MENTIONS]->(b {id: $d}) SET r.w = $w`, { s: ids.t1, d: ids.tool, w: 0.9 }));
await show('read after SET', async () => (await s.q(`MATCH (a {id: ${ids.t1}})-[r:MENTIONS]->(b) RETURN b.id AS dst, r.w AS w ORDER BY dst`)).rows.map(r => r.map(cell)));
await show('UNION ALL two sources, one request', async () => (await s.q(`MATCH (a {id: ${ids.t1}})-[r:MENTIONS]->(b) RETURN a.id AS src, b.id AS dst, r.w AS w UNION ALL MATCH (a {id: ${ids.t2}})-[r:MENTIONS]->(b) RETURN a.id AS src, b.id AS dst, r.w AS w`)).rows.length);
await show('unweighted edge MERGE twice (idempotent?)', async () => {
  await s.q(`MERGE (a {id: $s})-[:REQUIRES]->(b {id: $d})`, { s: ids.t2, d: ids.tool });
  await s.q(`MERGE (a {id: $s})-[:REQUIRES]->(b {id: $d})`, { s: ids.t2, d: ids.tool });
  return (await s.q(`MATCH (a {id: ${ids.t2}})-[r:REQUIRES]->(b) RETURN b.id AS dst`)).rows.length;
});
await show('read unweighted edge r.w -> null', async () => (await s.q(`MATCH (a {id: ${ids.t2}})-[r:REQUIRES]->(b) RETURN b.id AS dst, r.w AS w`)).rows);
await show('two-hop path in one MATCH', async () => (await s.q(`MATCH (t:Term {id: ${ids.t1}})-[r:MENTIONS]->(x)-[:REQUIRES]->(y) RETURN x.id AS mid, y.id AS dst`)).rows.length);
await show('reverse direction pattern', async () => (await s.q(`MATCH (b {id: ${ids.tool}})<-[r:MENTIONS]-(a) RETURN a.id AS src, r.w AS w`)).rows.length);
await show('nodes by label with props', () => s.nodesByLabel('Term', ['name', 'df']));
await show('property update on node', () => s.setNodeProps(ids.t1, { df: 4 }));
await show('delete edge', () => s.q(`MATCH (a {id: $s})-[r:MENTIONS]->(b {id: $d}) DELETE r`, { s: ids.t1, d: ids.tool2 }));
await show('delete test nodes', () => s.q(`UNWIND $rows AS row MATCH (n {id: row.id}) DETACH DELETE n`, { rows: Object.values(ids).map(id => ({ id })) }));
