# Building on HydraDB: what bit me, and what I did about it

Notes from building Context Graph on a self-built HydraDB v0.4.0 node. Items marked **found** were hit and fixed while building this;
items marked **docs** are documented traps I designed around from the start (see `USING-HYDRADB.md` in the HydraDB repo).

## Getting a node running

- **found: Ubuntu has no LAGraph package.** `cargo build` fails at link time with `unable to find library -llagraph`.
  `scripts/install_lagraph.sh /opt/lagraph` builds it statically; then `LAGRAPH_LIB_DIR=/opt/lagraph/lib`.
  The runtime then needs only `libgraphblas7` and `libgomp1` (the Docker image for the demo is built on exactly that).
- **found: `RUST_MIN_STACK=33554432` is not optional.** Without it the node starts, answers `/readyz`, then dies on the first query.
- The build takes about four minutes on four cores once dependencies are compiled; the first compile is much longer on 3 GB of RAM (use `-j3`).

## Shapes that work inside the dialect

| Need | Shape used |
|---|---|
| Many nodes with a label and properties | `UNWIND $rows AS row MERGE (n {id: row.id}) SET n:Label, n.name = row.name` |
| A weighted edge | `CREATE (a {id: $s})-[:T {w: $w}]->(b {id: $d})` |
| Change a weight | `MATCH (a {id: $s})-[r:T]->(b {id: $d}) SET r.w = $w` |
| Read weighted edges of several nodes in one request | one `MATCH (a {id: N})-[r:T]->(b) RETURN a.id AS src, b.id AS dst, r.w AS w` per node, joined with `UNION ALL` |

## Traps

1. **found: `MATCH ... SET` on a missing edge succeeds and does nothing.** My first learning loop "reinforced" edges that did not exist, so new links never appeared and held-out accuracy sat about ten points lower (55% instead of 67% after two passes) until I found it.
   Fix: the learner knows whether an edge is new, and creates it explicitly; only existing edges are updated with `SET`.
2. **found: `UNION ALL` with a repeated start node returns its rows twice.** A word that was both in the task and a similar-word target had its edges counted twice, which shifted rankings between stores.
   Fix: deduplicate start ids before building the query.
3. **found: results stop at `page_size` (default 1024) without any error.** A wide fan-out would be cut short silently.
   Fix: always send `page_size: 4096` and follow `next_cursor`, resending the whole request with `cursor` and `query_id`, fetching each page exactly once.
4. **found: equal scores come back in a different order from a different store.** A parity test (same graph in HydraDB and in memory, 160 retrievals) showed 59/80 identical on a cold graph, all differences being near-ties reordered.
   Fix: round scores and break ties by tool name. Parity is now 80/80 before and after learning (`test/parity.mjs`).
5. **docs: node identity is the numeric `id`.** There is no auto id, so ids are stable 52-bit hashes of label and name. Several independent graphs share one database by hashing in a namespace salt, which is how the five benchmark runs live side by side.
6. **docs: `CREATE` of the same relationship twice makes two edges.** Unweighted edges use `MERGE`. Weighted ones are created exactly once and then updated.
7. **docs: `RETURN` takes properties and aggregates only,** and every relationship pattern needs one type. The retrieval is therefore a sequence of one-type hops, not a clever single query.
8. **docs: unlabelled nodes are invisible to label-anchored scans.** Every node is labelled when it is written.
