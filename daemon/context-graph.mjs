import { HydraStore } from '../contextgraph/src/store-hydradb.mjs';
import { ContextGraph } from '../contextgraph/src/graph.mjs';
import { setNamespace } from '../contextgraph/src/text.mjs';

/**
 * Context Graph for Mimir's agent loop (optional, off by default).
 *
 * When on, the tools offered to the model for a turn are the few a HydraDB graph pulls for that
 * request instead of every tool the bot has. After the turn, the tools that really ran feed back
 * into the graph. It always fails open: if HydraDB is down, the graph is unsure, or anything
 * throws, the turn runs exactly as it would have without it.
 *
 * Enable in settings: contextGraph: { enabled: true, url: 'http://127.0.0.1:18443' } and set
 * MIMIR_CONTEXT_GRAPH_TOKEN (the HydraDB bearer token) in the environment.
 */
const serverOf = name => (name.startsWith('mcp__') ? name.split('__')[1] : 'mimir');
const nameOf = t => t?.function?.name || t?.name || '';
const descOf = t => t?.function?.description || t?.description || nameOf(t);

export class AgentContextGraph {
  constructor({ getSettings, store = null, namespace = 'mimir' } = {}) {
    this.getSettings = getSettings;
    this.injectedStore = store;
    this.namespace = namespace;
    this.graph = null;
    this.initPromise = null;
    this.lastPull = null;
    this.failures = 0;
  }

  get enabled() {
    return Boolean(this.getSettings?.()?.contextGraph?.enabled) && this.failures < 3;
  }

  async #init() {
    if (this.graph) return this.graph;
    this.initPromise ||= (async () => {
      const cfg = this.getSettings().contextGraph || {};
      const store = this.injectedStore || new HydraStore({ url: cfg.url || 'http://127.0.0.1:18443', token: process.env.MIMIR_CONTEXT_GRAPH_TOKEN || '' });
      await store.init();
      setNamespace(this.namespace);
      const g = new ContextGraph(store, { k: cfg.k || 6 });
      await g.restore(serverOf);
      this.graph = g;
      return g;
    })();
    try {
      return await this.initPromise;
    } catch (err) {
      this.initPromise = null;
      throw err;
    }
  }

  /** The subset of `tools` to offer for this request, or null to keep the full list. */
  async select(userText, tools) {
    if (!this.enabled || !Array.isArray(tools) || tools.length < 8 || String(userText || '').trim().length < 4) return null;
    try {
      const g = await this.#init();
      setNamespace(this.namespace);
      const known = new Set([...g.tools.values()].map(x => x.name));
      for (const t of tools) {
        const name = nameOf(t);
        if (name && !known.has(name)) await g.addTool({ id: name, server: serverOf(name), description: descOf(t) });
      }
      const r = await g.retrieve(userText);
      this.lastPull = { at: new Date().toISOString(), pulled: r.tools.length, of: tools.length, confident: r.confident, ms: r.ms, requests: r.requests, tools: r.tools.map(x => x.id) };
      if (!r.confident || !r.tools.length) return null;
      const keep = new Set(r.tools.map(x => x.id));
      const subset = tools.filter(t => keep.has(nameOf(t)));
      return subset.length ? subset : null;
    } catch (err) {
      this.failures += 1;
      this.lastPull = { error: err.message, at: new Date().toISOString() };
      return null;
    }
  }

  /** After the turn: which tools really ran. Learns only from tools that were on offer and worked. */
  async record({ userText, turnMessages, offered }) {
    if (!this.enabled || !this.graph) return;
    try {
      const used = [...new Set((turnMessages || []).filter(m => m.role === 'tool' && m.approved !== false && !String(m.content || '').startsWith('ERROR:')).map(m => m.toolName).filter(Boolean))];
      if (!used.length) return;
      setNamespace(this.namespace);
      await this.graph.learn({ text: userText, used, retrieved: offered || [] });
      this.lastPull = { ...(this.lastPull || {}), learnedFrom: used };
    } catch (err) {
      this.failures += 1;
      this.lastPull = { error: err.message, at: new Date().toISOString() };
    }
  }

  status() {
    return { enabled: this.enabled, connected: Boolean(this.graph), failures: this.failures, lastPull: this.lastPull };
  }
}
