// HydraDB store: the graph lives in a running HydraDB node (github.com/hydra-db/hydradb) and every
// read and write goes through its HTTP query API as OpenCypher. Nothing is cached client-side.
//
// HydraDB's dialect is narrow (see USING-HYDRADB.md). The shapes used here, all verified live:
//   nodes   UNWIND $rows AS row MERGE (n {id: row.id}) SET n:Label, n.name = row.name
//   edges   MERGE / CREATE (a {id: $s})-[:T {w: $w}]->(b {id: $d})      weight changes: MATCH ... SET r.w
//   reads   MATCH (a {id: N})-[r:T]->(b) RETURN a.id AS src, b.id AS id, r.w AS w
//           several sources in ONE request, joined with UNION ALL
// Node identity is the numeric `id`, so ids are stable hashes of label and name (see text.mjs).

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE = 4096; // HydraDB's largest page

export class HydraStore {
  constructor({ url = 'http://127.0.0.1:18443', token = 'local-dev-auth-token-32-characters-long', graph = 'default', cell = 'cell-0', namespace = 'local', concurrency = 12 } = {}) {
    this.kind = 'hydradb';
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.graph = graph;
    this.cell = cell;
    this.namespace = namespace;
    this.concurrency = concurrency;
    this.requests = 0;
    this.latencies = [];
    this.edgeCount = {}; // edges this process created, by type (a count query over a shared database would mix graphs)
  }

  async q(query, parameters, { retries = 2 } = {}) {
    this.requests++;
    const t0 = performance.now();
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`${this.url}/v1/graphs/${this.graph}/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'X-Graph-Namespace': this.namespace, 'Content-Type': 'application/json' },
          body: JSON.stringify({ cell_id: this.cell, query, ...(parameters ? { parameters } : {}), page_size: PAGE }),
        });
        const text = await res.text();
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          throw new Error(`HydraDB ${res.status}: ${text.slice(0, 200)}`);
        }
        if (body.error) throw new Error(`HydraDB ${body.error.code}: ${body.error.message}`);
        if (!('rows' in body)) throw new Error(`HydraDB ${res.status}: ${text.slice(0, 200)}`);
        // A page holds at most `page_size` rows (default 1024). Reads follow the cursor so a wide
        // fan-out is never silently cut short. Each cursor use consumes a page, so pages are
        // fetched exactly once and in order.
        let pages = 0;
        while (body.next_cursor !== null && body.next_cursor !== undefined && pages++ < 50) {
          this.requests++;
          const more = await (await fetch(`${this.url}/v1/graphs/${this.graph}/query`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}`, 'X-Graph-Namespace': this.namespace, 'Content-Type': 'application/json' },
            body: JSON.stringify({ cell_id: this.cell, query, ...(parameters ? { parameters } : {}), page_size: PAGE, cursor: body.next_cursor, query_id: body.query_id }),
          })).json();
          if (more.error || !('rows' in more)) throw new Error(`HydraDB paging failed: ${JSON.stringify(more).slice(0, 160)}`);
          body.rows.push(...more.rows);
          body.next_cursor = more.next_cursor;
        }
        this.latencies.push(performance.now() - t0);
        return body;
      } catch (err) {
        lastErr = err;
        if (/invalid_request|parse error|not supported/i.test(err.message)) throw err;
        await sleep(50 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  async init() {
    const res = await fetch(`${this.url}/healthz`);
    if (!res.ok) throw new Error(`HydraDB not healthy at ${this.url}`);
  }

  /** Run async jobs with bounded concurrency. */
  async pool(items, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(this.concurrency, items.length) }, async () => {
        while (i < items.length) {
          const n = i++;
          out[n] = await fn(items[n], n);
        }
      }),
    );
    return out;
  }

  async upsertNodes(rows) {
    const byLabel = new Map();
    for (const r of rows) {
      const key = `${r.label}|${Object.keys(r.props).sort().join(',')}`;
      if (!byLabel.has(key)) byLabel.set(key, { label: r.label, keys: Object.keys(r.props).sort(), rows: [] });
      byLabel.get(key).rows.push({ id: r.id, ...r.props });
    }
    for (const g of byLabel.values()) {
      const sets = g.keys.map(k => `n.${k} = row.${k}`).join(', ');
      for (let i = 0; i < g.rows.length; i += 1000) {
        await this.q(`UNWIND $rows AS row MERGE (n {id: row.id}) SET n:${g.label}${sets ? `, ${sets}` : ''}`, { rows: g.rows.slice(i, i + 1000) });
      }
    }
  }

  async setNodeProps(id, props) {
    for (const [k, v] of Object.entries(props)) await this.q(`MATCH (n {id: $id}) SET n.${k} = $v`, { id, v });
  }

  async nodesByLabel(label, keys = ['name']) {
    const cols = keys.map(k => `n.${k} AS ${k}`).join(', ');
    const { rows, columns } = await this.q(`MATCH (n:${label}) RETURN n.id AS id, ${cols}`);
    return rows.map(r => Object.fromEntries(columns.map((c, i) => [c, cell(r[i])])));
  }

  async upsertEdge(type, src, dst, props = {}) {
    const w = props.w;
    if (w === undefined) {
      await this.q(`MERGE (a {id: $s})-[:${type}]->(b {id: $d})`, { s: src, d: dst });
      this.edgeCount[type] = (this.edgeCount[type] || 0) + 1;
      return;
    }
    // Edge with a weight: replace it so there is never a parallel edge with another weight.
    await this.q(`MATCH (a {id: $s})-[r:${type}]->(b {id: $d}) DELETE r`, { s: src, d: dst });
    await this.q(`CREATE (a {id: $s})-[:${type} {w: $w}]->(b {id: $d})`, { s: src, d: dst, w });
  }

  async upsertEdges(type, rows) {
    // Seeding: edges are new, so create them directly (no delete first), concurrently.
    this.edgeCount[type] = (this.edgeCount[type] || 0) + rows.length;
    await this.pool(rows, r => (r.w === undefined
      ? this.q(`CREATE (a {id: $s})-[:${type}]->(b {id: $d})`, { s: r.src, d: r.dst })
      : this.q(`CREATE (a {id: $s})-[:${type} {w: $w}]->(b {id: $d})`, { s: r.src, d: r.dst, w: r.w })));
  }

  async applyEdgeWrites(type, rows) {
    await this.pool(rows, async r => {
      if (r.remove) {
        this.edgeCount[type] = (this.edgeCount[type] || 1) - 1;
        return this.q(`MATCH (a {id: $s})-[r:${type}]->(b {id: $d}) DELETE r`, { s: r.src, d: r.dst });
      }
      // MATCH ... SET changes nothing when the edge is absent, so new edges are created explicitly.
      if (r.create) {
        this.edgeCount[type] = (this.edgeCount[type] || 0) + 1;
      }
      if (r.create) return this.q(`CREATE (a {id: $s})-[:${type} {w: $w}]->(b {id: $d})`, { s: r.src, d: r.dst, w: r.w });
      return this.q(`MATCH (a {id: $s})-[r:${type}]->(b {id: $d}) SET r.w = $w`, { s: r.src, d: r.dst, w: r.w });
    });
  }

  /** Edges leaving every source id, in ONE request (UNION ALL of one MATCH per source). */
  async outMany(type, srcIdsIn) {
    // One branch per distinct source: a repeated id would return its rows twice and double its score.
    const srcIds = [...new Set(srcIdsIn)];
    const out = new Map(srcIds.map(s => [s, []]));
    if (!srcIds.length) return out;
    for (let i = 0; i < srcIds.length; i += 40) {
      const chunk = srcIds.slice(i, i + 40);
      const query = chunk.map(s => `MATCH (a {id: ${Number(s)}})-[r:${type}]->(b) RETURN a.id AS src, b.id AS dst, r.w AS w`).join(' UNION ALL ');
      const { rows } = await this.q(query);
      for (const [s, d, w] of rows) {
        const wv = cell(w);
        out.get(cell(s))?.push({ dst: cell(d), w: wv === undefined || wv === null ? 1 : Number(wv) });
      }
    }
    return out;
  }

  async stats() {
    return { requests: this.requests };
  }

  async clear() {}
}

/** Unwrap a typed HydraDB cell: {type, value} -> value (null cells have no value). */
export function cell(c) {
  if (c === null || typeof c !== 'object') return c;
  if (c.type === 'null') return null;
  if (c.type === 'list') return c.value.map(cell);
  return c.value;
}
