// In-process graph with the same primitives as the HydraDB store. Used for unit tests and as the
// fallback when no HydraDB server is configured. It is NOT what the benchmark reports as "graph":
// every number labelled HydraDB was produced against a running HydraDB node.

export class MemoryStore {
  constructor() {
    this.kind = 'memory';
    this.nodes = new Map(); // id -> { label, props }
    this.edges = new Map(); // type -> Map(src -> Map(dst -> props))
    this.requests = 0;
  }

  async init() {}

  async upsertNodes(rows) {
    for (const r of rows) {
      const cur = this.nodes.get(r.id);
      this.nodes.set(r.id, { label: r.label, props: { ...(cur?.props || {}), ...r.props } });
    }
  }

  async setNodeProps(id, props) {
    const n = this.nodes.get(id);
    if (n) n.props = { ...n.props, ...props };
  }

  async nodesByLabel(label) {
    return [...this.nodes.entries()].filter(([, n]) => n.label === label).map(([id, n]) => ({ id, ...n.props }));
  }

  async getNodes(ids) {
    this.requests++;
    return ids.map(id => ({ id, ...(this.nodes.get(id)?.props || {}), exists: this.nodes.has(id) }));
  }

  #type(type) {
    if (!this.edges.has(type)) this.edges.set(type, new Map());
    return this.edges.get(type);
  }

  async upsertEdge(type, src, dst, props = {}) {
    const bySrc = this.#type(type);
    if (!bySrc.has(src)) bySrc.set(src, new Map());
    bySrc.get(src).set(dst, { ...(bySrc.get(src).get(dst) || {}), ...props });
  }

  async upsertEdges(type, rows) {
    for (const r of rows) await this.upsertEdge(type, r.src, r.dst, { w: r.w });
  }

  async applyEdgeWrites(type, rows) {
    for (const r of rows) {
      if (r.remove) await this.removeEdge(type, r.src, r.dst);
      else await this.upsertEdge(type, r.src, r.dst, { w: r.w });
    }
  }

  async removeEdge(type, src, dst) {
    this.#type(type).get(src)?.delete(dst);
  }

  /** Edges leaving each id: Map(src -> [{ dst, w }]). One request, like the HydraDB batch read. */
  async outMany(type, srcIds) {
    this.requests++;
    const out = new Map();
    const bySrc = this.#type(type);
    for (const s of srcIds) out.set(s, [...(bySrc.get(s)?.entries() || [])].map(([dst, p]) => ({ dst, w: p.w ?? 1 })));
    return out;
  }

  async stats() {
    let edges = 0;
    for (const m of this.edges.values()) for (const d of m.values()) edges += d.size;
    return { nodes: this.nodes.size, edges };
  }

  async clear() {
    this.nodes.clear();
    this.edges.clear();
  }
}
