import { HydraStore } from '../contextgraph/src/store-hydradb.mjs';
import { ContextGraph } from '../contextgraph/src/graph.mjs';
import { setNamespace } from '../contextgraph/src/text.mjs';
import { createEmbedder } from '../contextgraph/src/embed-similar.mjs';

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
    this.activeConfigKey = '';
    this.lastPull = null;
    this.failures = 0;
    this.lastFailureAt = 0;
  }

  get enabled() {
    if (!this.getSettings?.()?.contextGraph?.enabled) return false;
    if (this.failures < 3) return true;
    // Circuit breaker: after 3 failures stay off for a minute, then try again (HydraDB may be back).
    if (Date.now() - this.lastFailureAt > 60_000) { this.failures = 0; return true; }
    return false;
  }

  async #init() {
    const cfg = this.getSettings().contextGraph || {};
    const url = cfg.url || 'http://127.0.0.1:18443';
    const k = cfg.k || 6;
    const key = `${url}|${k}`;
    if (this.graph && this.activeConfigKey === key) return this.graph;
    if (this.activeConfigKey && this.activeConfigKey !== key) {
      this.graph = null;
      this.initPromise = null;
    }
    this.initPromise ||= (async () => {
      const store = this.injectedStore || new HydraStore({ url, token: process.env.MIMIR_CONTEXT_GRAPH_TOKEN || cfg.token || undefined });
      await store.init();
      setNamespace(this.namespace);
      const g = new ContextGraph(store, { k, embedBudgetMs: 40 });
      // Words the graph has never seen are embedded live. It fails open: no Ollama or model just means no extra links.
      g.embedUnknown = createEmbedder({ url: this.getSettings().ollamaUrl || undefined });
      await g.restore(serverOf);
      // Load the embedder's anchor vectors once, up front and without the per-request budget, so no turn waits for them.
      { const budget = g.o.embedBudgetMs; g.o.embedBudgetMs = Infinity; await g.retrieve('qwertyuiop').catch(() => {}); g.o.embedBudgetMs = budget; }
      this.activeConfigKey = key;
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
    this.narrowed = false;
    if (!this.enabled || !Array.isArray(tools) || tools.length < 8 || typeof userText !== 'string' || userText.trim().length < 4) return null;
    try {
      const g = await this.#init();
      setNamespace(this.namespace);
      const known = new Set([...g.tools.values()].map(x => x.name));
      for (const t of tools) {
        const name = nameOf(t);
        if (name && !known.has(name)) await g.addTool({ id: name, server: serverOf(name), description: descOf(t) });
      }
      const r = await g.retrieve(String(userText || '').slice(0, 1500));
      this.lastPull = { at: new Date().toISOString(), pulled: r.tools.length, of: tools.length, confident: r.confident, ms: r.ms, requests: r.requests, tools: r.tools.map(x => x.id) };
      if (!r.confident || !r.tools.length) return null;
      const keep = new Set(r.tools.map(x => x.id));
      const subset = tools.filter(t => keep.has(nameOf(t)));
      this.failures = 0; // a healthy pull: transient errors spread over hours must not add up to a trip
      this.narrowed = subset.length > 0;
      return subset.length ? subset : null;
    } catch (err) {
      this.failures += 1;
      this.lastFailureAt = Date.now();
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
      // "Offered but not used" only counts against a tool when the graph narrowed the list. On a full-list turn
      // (the graph was unsure) not being picked out of 100+ tools says nothing, so learn from what worked only.
      await this.graph.learn({ text: String(userText || '').slice(0, 1500), used, retrieved: this.narrowed ? offered || [] : [] });
      this.lastPull = { ...(this.lastPull || {}), learnedFrom: used };
    } catch (err) {
      this.failures += 1;
      this.lastFailureAt = Date.now();
      this.lastPull = { error: err.message, at: new Date().toISOString() };
    }
  }

  status() {
    return { enabled: this.enabled, connected: Boolean(this.graph), failures: this.failures, lastPull: this.lastPull };
  }
}
