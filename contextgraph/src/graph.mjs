import { nodeId, tokens } from './text.mjs';

/**
 * ContextGraph: a live context store for an agent, kept in a graph database.
 *
 * Nodes   Tool, Skill, Server, Term (a word the agent has seen), Entity (a thing it resolved)
 * Edges   Term -MENTIONS{w}-> Tool | Skill      what a word points at (learned weight)
 *         Skill -REQUIRES-> Tool                 the tools a procedure needs
 *         Server -SERVES-> Tool                  which system a tool belongs to
 *         Entity -RESOLVES_TO{w}-> Server        where a thing the agent resolved lives
 *         Tool -NEXT{w}-> Tool                   tools that were used together
 *
 * Retrieval turns a task into words, follows edges (word -> tool, word -> skill -> tools,
 * entity -> server -> tools, tool -> tool) and returns only the few tools the task needs.
 * Learning changes edge weights and adds edges from what the agent actually used.
 */

export const DEFAULTS = {
  k: 6, // most tools returned
  minTools: 3,
  relCutoff: 0.3, // keep tools scoring at least this fraction of the best
  minScore: 0.05, // below this no word pointed at a tool: `confident` is false and the caller should fall back
  kWeak: 12, // when the match is weak (top score below strongScore) offer up to this many tools instead of k: coverage rises for about 100 more tokens
  strongScore: 1, // top score at or above this is `strong`; held-out, 84% of tasks reach it and 72% of those are complete (the rest: 67.5%)
  skillBoost: 0.9, // how much of a skill's score flows to the tools it requires
  entityBoost: 2, // multiplier slope for tools on a system the entity lives in
  coUseBoost: 0, // tools used together no longer boost each other: it hurt jobs the graph had not seen (see bench/unseen-jobs.mjs)
  eta: 0.5, // learning rate for reinforcement
  lambda: 0.3, // decay for tools that were pulled but not used
  newEdge: 0.12, // starting weight of an edge created from experience (weaker than before: stronger edges hurt unseen jobs)
  similarWeight: 0.6, // how much a semantically similar word counts compared with the exact word
  minIdfToLearn: 0.25, // generic words never become edges
  prune: 0.03,
};

const uniq = a => [...new Set(a)];

export class ContextGraph {
  constructor(store, opts = {}) {
    this.store = store;
    this.o = { ...DEFAULTS, ...opts };
    this.tools = new Map(); // id -> { name, server }
    this.skills = new Map(); // id -> { name }
    this.serverOfTool = new Map();
    this.df = new Map(); // term -> number of documents it is linked to
    this.docCount = 1;
    this.termName = new Map(); // term id -> word
    this.serverName = new Map(); // server id -> name
    this.entityById = new Map(); // entity id -> name
    this.hasSimilar = false;
    this.entities = new Map(); // lowercase name -> { id, name }
  }

  // ---------- ingestion ----------

  /** Cold start: build the graph from tool descriptions, skills and servers. No usage data. */
  async seed({ tools, skills = [], servers = [] }) {
    const nodeRows = [];
    for (const s of servers) {
      this.serverName.set(nodeId('Server', s), s);
      nodeRows.push({ id: nodeId('Server', s), label: 'Server', props: { name: s } });
    }
    for (const t of tools) {
      const id = nodeId('Tool', t.id);
      this.tools.set(id, { name: t.id, server: t.server });
      nodeRows.push({ id, label: 'Tool', props: { name: t.id } });
    }
    for (const [name] of skills) {
      const id = nodeId('Skill', name);
      this.skills.set(id, { name });
      nodeRows.push({ id, label: 'Skill', props: { name } });
    }
    await this.store.upsertNodes(nodeRows);

    for (const t of tools) {
      const tid = nodeId('Tool', t.id);
      this.serverOfTool.set(tid, nodeId('Server', t.server));
      await this.store.upsertEdge('SERVES', nodeId('Server', t.server), tid, {});
    }
    for (const [name, , requires] of skills) {
      for (const r of requires) await this.store.upsertEdge('REQUIRES', nodeId('Skill', name), nodeId('Tool', r), {});
    }

    const docs = [
      ...tools.map(t => ({ id: nodeId('Tool', t.id), words: [...tokens(t.id.replace(/__/g, ' ').replace(/_/g, ' ')), ...tokens(t.id.replace(/__/g, ' ').replace(/_/g, ' ')), ...tokens(t.description)] })),
      ...skills.map(([name, desc]) => ({ id: nodeId('Skill', name), words: [...tokens(name.replace(/-/g, ' ')), ...tokens(name.replace(/-/g, ' ')), ...tokens(desc)] })),
    ];
    this.docCount = docs.length;
    const dfLocal = new Map();
    for (const d of docs) for (const w of new Set(d.words)) dfLocal.set(w, (dfLocal.get(w) || 0) + 1);
    this.df = dfLocal;
    for (const w of dfLocal.keys()) this.termName.set(nodeId('Term', w), w);

    const termRows = [...dfLocal.entries()].map(([w, df]) => ({ id: nodeId('Term', w), label: 'Term', props: { name: w, df } }));
    await this.store.upsertNodes(termRows);

    const maxIdf = Math.log(1 + this.docCount);
    const edges = [];
    for (const d of docs) {
      const tf = new Map();
      for (const w of d.words) tf.set(w, (tf.get(w) || 0) + 1);
      const scored = [...tf.entries()]
        .map(([w, c]) => ({ w, s: (1 + Math.log(c)) * Math.log(1 + this.docCount / (1 + dfLocal.get(w))) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 12);
      const top = scored[0]?.s || 1;
      for (const { w, s } of scored) edges.push({ src: nodeId('Term', w), dst: d.id, w: +(0.15 + 0.85 * (s / top)).toFixed(3) });
    }
    await this.store.upsertEdges('MENTIONS', edges);
    this.maxIdf = maxIdf;
  }

  /**
   * Reconnect to a graph that already exists in the store (a restart): rebuild the in-memory
   * lookups from the stored nodes instead of seeding again, which would duplicate edges.
   * `serverOf(toolName)` says which system a tool belongs to.
   */
  async restore(serverOf = n => n.split('__')[0]) {
    const [allTools, allSkills, allTerms, allEntities] = await Promise.all([
      this.store.nodesByLabel('Tool', ['name']),
      this.store.nodesByLabel('Skill', ['name']),
      this.store.nodesByLabel('Term', ['name', 'df']),
      this.store.nodesByLabel('Entity', ['name']),
    ]);
    // The store can hold other graphs too. Node ids are salted with the namespace, so keep only this graph's.
    const mine = label => n => n.id === nodeId(label, n.name);
    const tools = allTools.filter(mine('Tool'));
    const terms = allTerms.filter(mine('Term'));
    const entities = allEntities.filter(mine('Entity'));
    for (const k of allSkills.filter(mine('Skill'))) this.skills.set(k.id, { name: k.name });
    this.hasSimilar = [...(await this.store.outMany('SIMILAR', terms.slice(0, 300).map(t => t.id))).values()].some(v => v.length);
    for (const t of tools) {
      this.tools.set(t.id, { name: t.name, server: serverOf(t.name) });
      this.serverOfTool.set(t.id, nodeId('Server', serverOf(t.name)));
      this.serverName.set(nodeId('Server', serverOf(t.name)), serverOf(t.name));
    }
    for (const t of terms) {
      this.termName.set(t.id, t.name);
      if (t.df > 0) this.df.set(t.name, t.df);
    }
    for (const e of entities) {
      this.entities.set(e.name.toLowerCase(), { id: e.id, name: e.name });
      this.entityById.set(e.id, e.name);
    }
    this.docCount = Math.max(1, this.tools.size + this.skills.size);
    return { tools: tools.length, skills: this.skills.size, terms: terms.length, entities: entities.length, similar: this.hasSimilar };
  }

  /** Semantic bridge: Term -SIMILAR{w}-> Term, from embedding neighbours built offline by tools/build-similar.mjs. */
  async loadSimilar(similar) {
    const rows = [];
    const edges = [];
    for (const [word, near] of similar) {
      this.termName.set(nodeId('Term', word), word);
      if (!this.df.has(word)) rows.push({ id: nodeId('Term', word), label: 'Term', props: { name: word, df: 0 } });
      for (const [anchor, w] of near) edges.push({ src: nodeId('Term', word), dst: nodeId('Term', anchor), w });
    }
    if (rows.length) await this.store.upsertNodes(rows);
    await this.store.upsertEdges('SIMILAR', edges);
    this.hasSimilar = true;
  }

  /** A tool appeared after seeding (a new MCP server connected). Add it without a rebuild. */
  async addTool(t) {
    const id = nodeId('Tool', t.id);
    if (this.tools.has(id)) return false;
    this.tools.set(id, { name: t.id, server: t.server });
    this.serverName.set(nodeId('Server', t.server), t.server);
    await this.store.upsertNodes([
      { id: nodeId('Server', t.server), label: 'Server', props: { name: t.server } },
      { id, label: 'Tool', props: { name: t.id } },
    ]);
    this.serverOfTool.set(id, nodeId('Server', t.server));
    await this.store.upsertEdge('SERVES', nodeId('Server', t.server), id, {});
    const words = uniq([...tokens(t.id.replace(/__/g, ' ').replace(/_/g, ' ')), ...tokens(t.description)]);
    this.docCount += 1;
    const rows = [];
    const edges = [];
    for (const w of words) {
      const tid = nodeId('Term', w);
      this.termName.set(tid, w);
      this.df.set(w, (this.df.get(w) || 0) + 1);
      rows.push({ id: tid, label: 'Term', props: { name: w, df: this.df.get(w) } });
      edges.push({ src: tid, dst: id, w: 0.5 });
    }
    await this.store.upsertNodes(rows);
    await this.store.upsertEdges('MENTIONS', edges);
    return true;
  }

  /** Remember an entity name the agent has resolved (no system links yet; those are learned). */
  async registerEntity(name) {
    const key = name.toLowerCase();
    if (this.entities.has(key)) return this.entities.get(key);
    const e = { id: nodeId('Entity', name), name };
    this.entityById.set(e.id, name);
    this.entities.set(key, e);
    await this.store.upsertNodes([{ id: e.id, label: 'Entity', props: { name } }]);
    return e;
  }

  /** Best score first. Scores are rounded and ties broken by tool name, so the answer does not depend on the order a store returns edges in. */
  byScore = (a, b) => +b[1].toFixed(9) - +a[1].toFixed(9) || String(this.tools.get(a[0])?.name).localeCompare(String(this.tools.get(b[0])?.name));

  idfn(term) {
    const df = this.df.get(term);
    if (df === undefined) return 0.6; // unseen word: treat as fairly specific
    return Math.min(1, Math.log(1 + this.docCount / (1 + df)) / Math.log(1 + this.docCount));
  }

  // ---------- retrieval ----------

  /**
   * Pull the tools a task needs. Returns the chosen tools, why each was chosen and how many
   * requests it cost. `confident:false` means no word in the task pointed anywhere.
   */
  async retrieve(text, { k = this.o.k } = {}) {
    const t0 = performance.now();
    const req0 = this.store.requests;
    const words = uniq(tokens(text));
    const entityHits = [...String(text).matchAll(/[A-Za-z][A-Za-z0-9]+/g)]
      .map(m => this.entities.get(m[0].toLowerCase()))
      .filter(Boolean);

    // 1. word -> (similar word ->) tool | skill
    const seedIds = words.map(w => nodeId('Term', w));
    let simSeeds = [];
    if (this.hasSimilar) {
      const sim = await this.store.outMany('SIMILAR', seedIds);
      const seen = new Map();
      words.forEach((w, i) => {
        for (const { dst, w: sw } of sim.get(seedIds[i]) || []) {
          const weight = sw * this.o.similarWeight;
          if (!seen.has(dst) || seen.get(dst).weight < weight) seen.set(dst, { id: dst, weight, via: w });
        }
      });
      simSeeds = [...seen.values()];
    }
    const termIds = [...seedIds, ...simSeeds.map(s => s.id)];
    const mentions = await this.store.outMany('MENTIONS', termIds);
    const score = new Map();
    const why = new Map();
    const trace = []; // every edge followed, for the explanation view
    const nm = id => this.tools.get(id)?.name || this.skills.get(id)?.name || this.termName.get(id) || this.serverName.get(id) || this.entityById.get(id) || String(id);
    const kd = id => (this.tools.has(id) ? 'tool' : this.skills.has(id) ? 'skill' : this.serverName.has(id) ? 'server' : this.entityById.has(id) ? 'entity' : 'word');
    const edge = (from, to, rel, w) => trace.push({ from: nm(from), fromKind: kd(from), to: nm(to), toKind: kd(to), rel, w: +Number(w).toFixed(2) });
    const add = (id, s, reason) => {
      score.set(id, (score.get(id) || 0) + s);
      const list = why.get(id) || [];
      if (list.length < 4) list.push(reason);
      why.set(id, list);
    };
    words.forEach((w, i) => {
      const idf = this.idfn(w);
      for (const { dst, w: ew } of mentions.get(seedIds[i]) || []) {
        add(dst, idf * ew, { kind: 'word', word: w, weight: +ew.toFixed(2) });
        edge(seedIds[i], dst, 'MENTIONS', ew);
      }
    });
    for (const s of simSeeds) {
      const anchor = this.termName.get(s.id);
      const idf = anchor ? this.idfn(anchor) : 0.6;
      const viaId = nodeId('Term', s.via);
      trace.push({ from: s.via, fromKind: 'word', to: anchor, toKind: 'word', rel: 'SIMILAR', w: +(s.weight / this.o.similarWeight).toFixed(2) });
      for (const { dst, w: ew } of mentions.get(s.id) || []) {
        add(dst, idf * ew * s.weight, { kind: 'similar', word: s.via, meansWord: anchor, weight: +ew.toFixed(2) });
        edge(s.id, dst, 'MENTIONS', ew);
      }
      void viaId;
    }

    // 2. skill -> required tools (one hop further)
    const skillIds = [...score.keys()].filter(id => this.skills.has(id));
    const toolScore = new Map();
    const toolWhy = new Map();
    const addTool = (id, s, reason) => {
      toolScore.set(id, (toolScore.get(id) || 0) + s);
      const list = toolWhy.get(id) || [];
      if (list.length < 4) list.push(reason);
      toolWhy.set(id, list);
    };
    for (const [id, s] of score) if (this.tools.has(id)) for (const r of why.get(id)) addTool(id, 0, r);
    for (const [id, s] of score) if (this.tools.has(id)) toolScore.set(id, s);
    if (skillIds.length) {
      const req = await this.store.outMany('REQUIRES', skillIds);
      for (const sid of skillIds) {
        const n = (req.get(sid) || []).length || 1;
        for (const { dst } of req.get(sid) || []) {
          addTool(dst, this.o.skillBoost * score.get(sid) * (1 / Math.sqrt(n)) * 1.4, { kind: 'skill', skill: this.skills.get(sid).name });
          edge(sid, dst, 'REQUIRES', 1);
        }
      }
    }

    // 3. entity -> server -> tools (a boost, not a source: the words still have to point at the tool)
    const entityInfo = [];
    if (entityHits.length) {
      const links = await this.store.outMany('RESOLVES_TO', entityHits.map(e => e.id));
      const serverW = new Map();
      for (const e of entityHits) for (const { dst, w } of links.get(e.id) || []) {
        serverW.set(dst, Math.max(serverW.get(dst) || 0, w));
        entityInfo.push({ entity: e.name, server: dst, w });
        edge(e.id, dst, 'RESOLVES_TO', w);
      }
      if (serverW.size) {
        const served = await this.store.outMany('SERVES', [...serverW.keys()]);
        for (const [srv, list] of served) for (const { dst } of list) {
          if (toolScore.has(dst)) {
            toolScore.set(dst, toolScore.get(dst) * (1 + this.o.entityBoost * serverW.get(srv)));
            toolWhy.get(dst)?.push({ kind: 'entity', entity: entityInfo.find(x => x.server === srv)?.entity });
            edge(srv, dst, 'SERVES', 1);
          }
        }
      }
    }

    // 4. tools used together before
    const anchors = [...toolScore.entries()].sort(this.byScore).slice(0, 3);
    if (anchors.length && this.o.coUseBoost > 0) {
      const next = await this.store.outMany('NEXT', anchors.map(a => a[0]));
      for (const [aid, as] of anchors) for (const { dst, w } of next.get(aid) || []) {
        addTool(dst, this.o.coUseBoost * as * w, { kind: 'used-with', tool: this.tools.get(aid)?.name });
        edge(aid, dst, 'NEXT', w);
      }
    }

    const ranked = [...toolScore.entries()].filter(([id]) => this.tools.has(id)).sort(this.byScore);
    const best = ranked[0]?.[1] || 0;
    const chosen = ranked.filter(([, s], i) => i < this.o.minTools || s >= this.o.relCutoff * best).slice(0, best >= this.o.strongScore ? k : Math.max(k, this.o.kWeak)).filter(([, s]) => s > 0);
    // Keep only the edges that lead to a chosen tool (walk back from the tools).
    const keep = new Set(chosen.map(([id]) => this.tools.get(id).name));
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of trace) if (keep.has(e.to) && !keep.has(e.from)) { keep.add(e.from); grew = true; }
    }
    return {
      tools: chosen.map(([id, s]) => ({ id: this.tools.get(id).name, score: +s.toFixed(3), why: toolWhy.get(id) || [] })),
      trace: trace.filter(e => keep.has(e.to) && keep.has(e.from)).slice(0, 80),
      skills: skillIds.map(id => this.skills.get(id).name),
      words,
      entities: entityHits.map(e => e.name),
      confident: best >= this.o.minScore,
      strong: best >= this.o.strongScore,
      requests: this.store.requests - req0,
      ms: +(performance.now() - t0).toFixed(2),
    };
  }

  // ---------- learning ----------

  /**
   * Learn from one finished task: which tools the agent really used, and which it was handed
   * but did not need. Reinforces edges that worked, adds edges for words that pointed nowhere
   * (gap-driven ingestion), decays edges that led to unused tools, and links entities to systems.
   */
  async learn({ text, used, retrieved = [] }) {
    const words = uniq(tokens(text));
    const o = this.o;
    used = uniq(used);
    const usedIds = used.map(u => nodeId('Tool', u));
    const unusedIds = retrieved.filter(r => !used.includes(r)).map(r => nodeId('Tool', r));
    const termIds = words.map(w => nodeId('Term', w));
    const current = await this.store.outMany('MENTIONS', termIds);
    const writes = [];
    const newTerms = [];
    const newEdges = [];

    words.forEach((w, i) => {
      const idf = this.idfn(w);
      if (idf < o.minIdfToLearn) return;
      const edges = new Map((current.get(termIds[i]) || []).map(e => [e.dst, e.w]));
      for (const u of usedIds) {
        if (edges.has(u)) writes.push({ src: termIds[i], dst: u, w: +Math.min(1, edges.get(u) + o.eta * idf * (1 - edges.get(u))).toFixed(3) });
        else {
          if (!this.df.has(w)) {
            this.df.set(w, 1);
            this.termName.set(termIds[i], w);
            newTerms.push({ id: termIds[i], label: 'Term', props: { name: w, df: 1 } });
          }
          newEdges.push({ src: termIds[i], dst: u, create: true, w: +(o.newEdge + 0.4 * idf).toFixed(3) });
        }
      }
      for (const f of unusedIds) {
        if (!edges.has(f) || usedIds.includes(f)) continue;
        const nw = edges.get(f) * (1 - o.lambda * idf);
        if (nw < o.prune) writes.push({ src: termIds[i], dst: f, remove: true });
        else writes.push({ src: termIds[i], dst: f, w: +nw.toFixed(3) });
      }
    });

    // entities: link the thing the agent resolved to the systems of the tools it used
    const entityHits = [...String(text).matchAll(/[A-Za-z][A-Za-z0-9]+/g)].map(m => this.entities.get(m[0].toLowerCase())).filter(Boolean);
    const entityWrites = [];
    if (entityHits.length) {
      const usedServers = uniq(usedIds.map(u => this.serverOfTool.get(u)).filter(Boolean));
      const unusedServers = uniq(unusedIds.map(u => this.serverOfTool.get(u)).filter(s => s && !usedServers.includes(s)));
      const links = await this.store.outMany('RESOLVES_TO', entityHits.map(e => e.id));
      for (const e of entityHits) {
        const have = new Map((links.get(e.id) || []).map(l => [l.dst, l.w]));
        for (const s of usedServers) entityWrites.push({ src: e.id, dst: s, create: !have.has(s), w: have.has(s) ? +Math.min(1, have.get(s) + o.eta * (1 - have.get(s))).toFixed(3) : 0.5 });
        for (const s of unusedServers) if (have.has(s)) {
          const nw = have.get(s) * (1 - o.lambda);
          entityWrites.push(nw < o.prune ? { src: e.id, dst: s, remove: true } : { src: e.id, dst: s, w: +nw.toFixed(3) });
        }
      }
    }

    // tools used together
    const coWrites = [];
    if (usedIds.length > 1 && o.coUseBoost > 0) {
      const next = await this.store.outMany('NEXT', usedIds);
      for (const a of usedIds) for (const b of usedIds) {
        if (a === b) continue;
        const have = (next.get(a) || []).find(e => e.dst === b)?.w;
        coWrites.push({ src: a, dst: b, create: have === undefined, w: have === undefined ? 0.3 : +Math.min(1, have + o.eta * (1 - have)).toFixed(3) });
      }
    }

    if (newTerms.length) await this.store.upsertNodes(newTerms);
    await this.store.applyEdgeWrites('MENTIONS', [...writes, ...newEdges]);
    await this.store.applyEdgeWrites('RESOLVES_TO', entityWrites);
    if (coWrites.length) await this.store.applyEdgeWrites('NEXT', coWrites);
    return { reinforced: writes.filter(w => !w.remove && w.w !== undefined).length, created: newEdges.length, entityLinks: entityWrites.length, removed: writes.filter(w => w.remove).length };
  }
}
