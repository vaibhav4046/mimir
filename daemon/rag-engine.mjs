import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fetchLiveSearch, tokenize } from './knowledge-rsi.mjs';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'can', 'must',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their', 'we', 'our', 'you',
  'your', 'he', 'she', 'his', 'her', 'what', 'which', 'who', 'whom', 'when', 'where', 'why',
  'how', 'not', 'no', 'yes', 'than', 'then', 'so', 'such', 'only', 'also', 'very', 'more',
  'most', 'some', 'any', 'all', 'each', 'every', 'both', 'few', 'many', 'much', 'other',
  'into', 'about', 'over', 'under', 'between', 'through', 'during', 'before', 'after',
  'please', 'tell', 'explain', 'describe', 'find', 'give', 'show', 'list', 'make', 'get',
]);

const RELATION_PATTERNS = [
  { re: /\b([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})\s+(?:uses?|utilizes?|leverages?)\s+([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})/gi, rel: 'uses' },
  { re: /\b([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})\s+(?:supports?|enables?|provides?)\s+([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})/gi, rel: 'supports' },
  { re: /\b([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})\s+(?:requires?|depends on|needs?)\s+([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})/gi, rel: 'depends_on' },
  { re: /\b([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})\s+(?:runs on|hosted on|binds to|connects to|routes to)\s+([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})/gi, rel: 'connects_to' },
  { re: /\b([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})\s+(?:stores?|persists?|writes to|saves to)\s+([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})/gi, rel: 'stores' },
  { re: /\b([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})\s+(?:guarantees?|ensures?|improves?|fixes?)\s+([A-Za-z0-9_.:/-]{2,}(?:\s+[A-Z0-9][A-Za-z0-9_.:/-]*){0,2})/gi, rel: 'ensures' },
];

function canonicalEntityId(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:/-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function meaningfulTokens(text) {
  return tokenize(text).filter(t => !STOPWORDS.has(t));
}

function isUsefulEntity(label) {
  const id = canonicalEntityId(label);
  if (!id || id.length < 2) return false;
  const parts = id.split(' ');
  if (parts.length === 1 && STOPWORDS.has(parts[0])) return false;
  if (parts.every(p => STOPWORDS.has(p))) return false;
  return true;
}

/**
 * Deterministic LightRAG-style lexical entity and relation extractor.
 * Avoids LLM latency on 6GB local GPUs during document ingestion.
 */
export function extractEntitiesAndRelations(text, title = '') {
  const full = [title, text].filter(Boolean).join('. ');
  const entities = new Map(); // id -> { id, label, type }
  const relations = [];

  const addEntity = (rawLabel, type = 'entity') => {
    const label = String(rawLabel || '').trim().replace(/^[,.;:()[\]"`']+|[.,;:()[\]"`']+$/g, '');
    if (!isUsefulEntity(label)) return null;
    const id = canonicalEntityId(label);
    if (!id || id.length > 64) return null;
    if (!entities.has(id)) {
      entities.set(id, { id, label, type });
    }
    return id;
  };

  // 1. Technical identifiers (model tags, filenames, snake_case, URLs/paths, camelCase)
  const techRe = /\b(?:[a-z][a-z0-9-]*:[a-z0-9._-]+|[A-Za-z0-9_-]+\.(?:mjs|js|json|py|rs|md|ts|jsx)|[a-z]+_[a-z0-9_]+|[A-Z]{2,}[A-Z0-9_-]*)\b/g;
  for (const m of full.matchAll(techRe)) {
    addEntity(m[0], 'tech');
  }

  // 2. Capitalized entity phrases (e.g. "Project Helios", "Rust WAL", "Qwen3 1.7B")
  const capRe = /\b([A-Z][A-Za-z0-9_.:/-]*(?:\s+(?:[A-Z][A-Za-z0-9_.:/-]*|[0-9]+(?:\.[0-9]+)?[A-Za-z]*)){0,3})\b/g;
  for (const m of full.matchAll(capRe)) {
    const words = m[1].split(/\s+/);
    while (words.length && STOPWORDS.has(words[0].toLowerCase())) words.shift();
    if (words.length) addEntity(words.join(' '), 'concept');
  }

  // 3. Relation pattern extraction + sentence-level co-occurrence
  const sentences = full.split(/(?<=[.!?])\s+|\r?\n+/).filter(Boolean).slice(0, 40);
  for (const sent of sentences) {
    const sentEntities = [];
    for (const pat of RELATION_PATTERNS) {
      pat.re.lastIndex = 0;
      for (const m of sent.matchAll(pat.re)) {
        const sId = addEntity(m[1], 'concept');
        const tId = addEntity(m[2], 'concept');
        if (sId && tId && sId !== tId) {
          relations.push({ source: sId, target: tId, relation: pat.rel, evidence: sent.slice(0, 180) });
          sentEntities.push(sId, tId);
        }
      }
    }

    for (const [id, ent] of entities.entries()) {
      if (sent.toLowerCase().includes(id) && !sentEntities.includes(id)) {
        sentEntities.push(id);
      }
      if (ent.label && sent.includes(ent.label) && !sentEntities.includes(id)) {
        sentEntities.push(id);
      }
    }

    const uniqSent = [...new Set(sentEntities)].slice(0, 6);
    for (let i = 0; i < uniqSent.length; i++) {
      for (let j = i + 1; j < uniqSent.length; j++) {
        relations.push({
          source: uniqSent[i],
          target: uniqSent[j],
          relation: 'co_occurs',
          evidence: sent.slice(0, 180),
        });
      }
    }
  }

  // 4. Fallback high-signal keywords from title / text if few entities were found
  if (entities.size < 3) {
    const counts = new Map();
    for (const tok of meaningfulTokens(full)) {
      if (tok.length >= 3) counts.set(tok, (counts.get(tok) || 0) + 1);
    }
    const topWords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [w] of topWords) addEntity(w, 'keyword');
  }

  return {
    entities: [...entities.values()].slice(0, 28),
    relations: relations.slice(0, 48),
  };
}

export function rewriteSearchQuery(query) {
  const raw = String(query || '').trim();
  if (!raw) return '';
  const stripped = raw
    .replace(/^(?:please\s+|can you\s+|could you\s+|tell me\s+|explain\s+|what is\s+|what are\s+|how does\s+|how do i\s+|why does\s+)/i, '')
    .replace(/[?!]+$/g, '')
    .trim();
  const tokens = meaningfulTokens(stripped);
  if (!tokens.length) return raw;
  // Preserve multi-char tokens, years, and technical names while trimming verbose prose
  const kept = stripped
    .split(/\s+/)
    .filter(w => {
      const clean = w.toLowerCase().replace(/[^a-z0-9_.:/-]/g, '');
      return clean && !STOPWORDS.has(clean);
    })
    .slice(0, 10);
  return kept.join(' ') || tokens.slice(0, 10).join(' ');
}

function jaccardSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  return inter / (setA.size + setB.size - inter);
}

export class RagEngine {
  constructor({ knowledgeBase = null, knowledgeDir = null, fetchSearch = fetchLiveSearch } = {}) {
    this.knowledgeBase = knowledgeBase;
    this.knowledgeDir = knowledgeDir || knowledgeBase?.dir || null;
    this.fetchSearch = fetchSearch;
    this.graphPath = this.knowledgeDir ? path.join(this.knowledgeDir, 'graph.json') : null;
    if (this.knowledgeDir) {
      fs.mkdirSync(this.knowledgeDir, { recursive: true });
    }
    this.graph = this.#loadGraph();
  }

  #emptyGraph() {
    return { version: 1, docIds: [], nodes: {}, edges: [], lastUpdated: null };
  }

  #loadGraph() {
    try {
      if (this.graphPath && fs.existsSync(this.graphPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.graphPath, 'utf8'));
        if (parsed && typeof parsed.nodes === 'object' && Array.isArray(parsed.edges)) {
          return {
            version: 1,
            docIds: Array.isArray(parsed.docIds) ? parsed.docIds : [],
            nodes: parsed.nodes,
            edges: parsed.edges,
            lastUpdated: parsed.lastUpdated || null,
          };
        }
      }
    } catch {
      // Ignore corrupt graph file and rebuild cleanly
    }
    return this.#emptyGraph();
  }

  #saveGraph() {
    if (!this.graphPath) return;
    const payload = JSON.stringify(this.graph, null, 2);
    const tmp = `${this.graphPath}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    try {
      fs.renameSync(tmp, this.graphPath);
    } catch {
      fs.writeFileSync(this.graphPath, payload, 'utf8');
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  saveGraph() {
    this.#saveGraph();
  }

  getGraphSummary() {
    return {
      nodes: Object.keys(this.graph.nodes).length,
      edges: this.graph.edges.length,
      docCount: this.graph.docIds.length,
      lastUpdated: this.graph.lastUpdated,
    };
  }

  upsertDocumentGraph(doc, { skipSave = false } = {}) {
    if (!doc) return { docId: null, entitiesAdded: 0, edgesAdded: 0 };
    const docId = doc.id || `kdoc-${crypto.createHash('sha1').update(String(doc.title || '') + String(doc.content || '')).digest('hex').slice(0, 8)}`;
    const contentText = Array.isArray(doc.chunks) && doc.chunks.length
      ? doc.chunks.map(c => c.text || '').join('\n')
      : String(doc.content || doc.text || '');

    if (!contentText.trim() && !String(doc.title || '').trim()) {
      return { docId, entitiesAdded: 0, edgesAdded: 0 };
    }

    if (this.graph.docIds.includes(docId)) {
      this.#pruneDocFromGraph(docId);
    }

    const { entities, relations } = extractEntitiesAndRelations(contentText, doc.title || '');
    let entitiesAdded = 0;
    let edgesAdded = 0;

    for (const ent of entities) {
      const existing = this.graph.nodes[ent.id];
      if (!existing) {
        this.graph.nodes[ent.id] = {
          id: ent.id,
          label: ent.label,
          type: ent.type,
          mentions: 1,
          docIds: [docId],
        };
        entitiesAdded++;
      } else {
        existing.mentions = (existing.mentions || 0) + 1;
        if (!existing.docIds.includes(docId)) existing.docIds.push(docId);
      }
    }

    for (const rel of relations) {
      const [a, b] = rel.relation === 'co_occurs' && rel.source > rel.target
        ? [rel.target, rel.source]
        : [rel.source, rel.target];
      const existingEdge = this.graph.edges.find(
        e => e.source === a && e.target === b && e.relation === rel.relation
      );
      if (!existingEdge) {
        this.graph.edges.push({
          source: a,
          target: b,
          relation: rel.relation,
          weight: 1,
          docIds: [docId],
          evidence: rel.evidence || '',
        });
        edgesAdded++;
      } else {
        existingEdge.weight = (existingEdge.weight || 1) + 1;
        if (!existingEdge.docIds.includes(docId)) existingEdge.docIds.push(docId);
      }
    }

    if (!this.graph.docIds.includes(docId)) {
      this.graph.docIds.push(docId);
    }
    this.graph.lastUpdated = new Date().toISOString();
    if (!skipSave) this.#saveGraph();
    return { docId, entitiesAdded, edgesAdded };
  }

  #pruneDocFromGraph(docId) {
    this.graph.docIds = this.graph.docIds.filter(id => id !== docId);
    for (const [id, node] of Object.entries(this.graph.nodes)) {
      if (Array.isArray(node.docIds) && node.docIds.includes(docId)) {
        node.docIds = node.docIds.filter(d => d !== docId);
        if (!node.docIds.length) delete this.graph.nodes[id];
      }
    }
    this.graph.edges = this.graph.edges.filter(e => {
      e.docIds = (e.docIds || []).filter(d => d !== docId);
      return e.docIds.length > 0 && this.graph.nodes[e.source] && this.graph.nodes[e.target];
    });
  }

  removeDocumentGraph(docId) {
    if (!docId || !this.graph.docIds.includes(docId)) return false;
    this.#pruneDocFromGraph(docId);
    this.graph.lastUpdated = new Date().toISOString();
    this.#saveGraph();
    return true;
  }

  indexGraphFromDocs({ rebuild = false } = {}) {
    if (rebuild) {
      this.graph = this.#emptyGraph();
    }
    const docs = this.knowledgeBase?.data?.docs || [];
    for (const doc of docs) {
      if (rebuild || !this.graph.docIds.includes(doc.id)) {
        this.upsertDocumentGraph(doc);
      }
    }
    if (rebuild && !docs.length) {
      this.graph.lastUpdated = new Date().toISOString();
      this.#saveGraph();
    }
    return this.getGraphSummary();
  }

  #matchGraphEntities(query) {
    const qLower = String(query || '').toLowerCase();
    const qTokens = meaningfulTokens(query);
    const qSet = new Set(qTokens);
    const { entities: qEntities } = extractEntitiesAndRelations(query, '');
    const qEntSet = new Set(qEntities.map(e => e.id));

    const directMatches = [];
    for (const node of Object.values(this.graph.nodes)) {
      const nTokens = meaningfulTokens(node.id);
      let score = 0;
      if (qEntSet.has(node.id) || (node.id.length >= 3 && qLower.includes(node.id))) {
        score = 1.0;
      } else if (nTokens.length) {
        const overlap = nTokens.filter(t => qSet.has(t)).length;
        if (overlap > 0 && overlap / nTokens.length >= 0.5) {
          score = 0.65 * (overlap / nTokens.length);
        }
      }
      if (score > 0) {
        directMatches.push({ ...node, hop: 0, matchScore: score, via: null });
      }
    }
    directMatches.sort((a, b) => b.matchScore - a.matchScore);
    const topDirect = directMatches.slice(0, 8);
    const directIds = new Set(topDirect.map(n => n.id));

    // 1-hop neighbors across LightRAG edges
    const neighborsMap = new Map();
    for (const edge of this.graph.edges) {
      const fromDirect = directIds.has(edge.source);
      const toDirect = directIds.has(edge.target);
      if (!fromDirect && !toDirect) continue;
      const neighborId = fromDirect ? edge.target : edge.source;
      if (directIds.has(neighborId)) continue;
      const neighborNode = this.graph.nodes[neighborId];
      if (!neighborNode) continue;
      const boost = Math.min(0.85, 0.45 + (edge.weight || 1) * 0.1);
      const prev = neighborsMap.get(neighborId);
      if (!prev || boost > prev.matchScore) {
        neighborsMap.set(neighborId, {
          ...neighborNode,
          hop: 1,
          matchScore: boost,
          via: `${fromDirect ? edge.source : edge.target} --[${edge.relation}]--> ${neighborId}`,
        });
      }
    }

    const neighborMatches = [...neighborsMap.values()]
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 10);

    return {
      directMatches: topDirect,
      neighborMatches,
      allMatched: [...topDirect, ...neighborMatches],
    };
  }

  #collectLocalCandidates(query, graphMatches) {
    const qTokens = meaningfulTokens(query);
    const qSet = new Set(qTokens);
    const qLower = String(query || '').toLowerCase();

    const docBoosts = new Map();
    const docEntities = new Map();
    for (const m of graphMatches.allMatched) {
      const w = m.hop === 0 ? 0.55 * m.matchScore : 0.35 * m.matchScore;
      for (const docId of m.docIds || []) {
        docBoosts.set(docId, Math.max(docBoosts.get(docId) || 0, w));
        const list = docEntities.get(docId) || [];
        list.push(m.label);
        docEntities.set(docId, list);
      }
    }

    const candidates = [];
    const docs = this.knowledgeBase?.data?.docs;
    if (Array.isArray(docs) && docs.length) {
      for (const doc of docs) {
        const recencyBoost = doc.yearTag === '2026' ? 1.15 : 1.0;
        const graphBoost = docBoosts.get(doc.id) || 0;
        for (const ch of doc.chunks || []) {
          const cTokens = ch.tokens?.length ? ch.tokens : tokenize(ch.text);
          const cSet = new Set(cTokens);
          let overlap = 0;
          for (const qt of qSet) if (cSet.has(qt)) overlap++;
          const titleOverlap = tokenize(doc.title).filter(t => qSet.has(t)).length;
          const phraseBonus = qLower.length >= 6 && ch.text.toLowerCase().includes(qLower) ? 0.35 : 0;

          if (overlap > 0 || titleOverlap > 0 || graphBoost > 0) {
            const lexicalScore = qSet.size
              ? ((overlap + titleOverlap * 0.5) / Math.sqrt(qSet.size * Math.max(1, Math.min(cSet.size, 30))))
              : 0;
            const totalScore = (lexicalScore * recencyBoost) + graphBoost + phraseBonus;
            candidates.push({
              docId: doc.id,
              title: doc.title,
              url: doc.url || '',
              source: graphBoost > 0 && overlap === 0 ? 'graph' : 'local',
              yearTag: doc.yearTag || '2026',
              text: ch.text,
              tokens: cTokens,
              tokenCoverage: qSet.size ? overlap / qSet.size : 0,
              graphBoost,
              matchedEntities: [...new Set(docEntities.get(doc.id) || [])],
              score: Number(totalScore.toFixed(3)),
            });
          }
        }
      }
    } else if (typeof this.knowledgeBase?.query === 'function') {
      const hits = this.knowledgeBase.query(query, 8) || [];
      for (const h of hits) {
        const cTokens = tokenize(h.text);
        const cSet = new Set(cTokens);
        const overlap = [...qSet].filter(qt => cSet.has(qt)).length;
        const graphBoost = docBoosts.get(h.docId) || 0;
        candidates.push({
          docId: h.docId,
          title: h.title,
          url: h.url || '',
          source: 'local',
          yearTag: h.yearTag || '2026',
          text: h.text,
          tokens: cTokens,
          tokenCoverage: qSet.size ? overlap / qSet.size : 0,
          graphBoost,
          matchedEntities: [...new Set(docEntities.get(h.docId) || [])],
          score: Number(((h.score || 0) + graphBoost).toFixed(3)),
        });
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  evaluateCragConfidence(query, candidates, graphMatches) {
    const qTokens = meaningfulTokens(query);
    if (!candidates.length) {
      return { grade: 'INCORRECT', confidence: 0 };
    }
    const top = candidates[0];
    const top3 = candidates.slice(0, 3);
    const unionTokens = new Set();
    for (const c of top3) {
      for (const t of c.tokens || tokenize(c.text)) unionTokens.add(t);
    }
    const aggCoverage = qTokens.length
      ? qTokens.filter(t => unionTokens.has(t)).length / qTokens.length
      : 0;
    const topCoverage = top.tokenCoverage || 0;
    const graphBonus = graphMatches.directMatches.length > 0
      ? Math.min(0.18, graphMatches.directMatches.length * 0.08)
      : 0;
    const scoreSignal = Math.min(0.32, (top.score || 0) * 0.25);

    const rawConf = Math.min(
      1,
      Math.max(0, topCoverage * 0.45 + aggCoverage * 0.25 + scoreSignal + graphBonus)
    );
    const confidence = Number(rawConf.toFixed(3));

    let grade = 'INCORRECT';
    if (confidence >= 0.7 && topCoverage >= 0.5) {
      grade = 'CORRECT';
    } else if (confidence >= 0.35 && (topCoverage >= 0.25 || aggCoverage >= 0.4 || graphMatches.directMatches.length > 0)) {
      grade = 'AMBIGUOUS';
    }
    return { grade, confidence };
  }

  #filterNoiseAndDedupe(query, candidates, topK) {
    const qTokens = meaningfulTokens(query);
    const qSet = new Set(qTokens);
    const kept = [];

    for (const c of candidates) {
      const cleaned = String(c.text || '').replace(/\s+/g, ' ').trim();
      if (cleaned.length < 16) continue;

      const cTokens = c.tokens?.length ? c.tokens : tokenize(cleaned);
      const cSet = new Set(cTokens);
      let overlap = 0;
      for (const t of qSet) if (cSet.has(t)) overlap++;

      const isRelevant = overlap > 0 || (c.graphBoost || 0) > 0 || qSet.size === 0;
      if (!isRelevant) continue;

      const isDup = kept.some(prev => jaccardSimilarity(prev.tokens, cTokens) > 0.82);
      if (isDup) continue;

      const tokenCoverage = qSet.size ? overlap / qSet.size : 0;
      const isSupported = Boolean(
        (tokenCoverage >= 0.45 && cleaned.length >= 24) ||
        (c.url && overlap >= 1) ||
        (c.graphBoost > 0 && overlap >= 1) ||
        c.matchedEntities?.length >= 2
      );

      const tags = [];
      if (isRelevant) tags.push('[IsRelevant]');
      if (isSupported) tags.push('[IsSupported]');

      kept.push({
        docId: c.docId || null,
        title: c.title || 'Untitled',
        url: c.url || '',
        source: c.source || 'local',
        score: c.score,
        text: cleaned,
        tokens: cTokens,
        isRelevant,
        isSupported,
        tags,
      });
      if (kept.length >= topK) break;
    }

    return kept.map(({ tokens, ...rest }) => rest);
  }

  async retrieve({ query, topK = 5, useWebFallback = true } = {}) {
    const cleanQuery = String(query || '').trim();
    const limit = Math.max(1, Math.min(Number(topK) || 5, 15));
    if (!cleanQuery) {
      return {
        query: '',
        grade: 'INCORRECT',
        confidence: 0,
        webUsed: false,
        citations: [],
        graphEntities: [],
        contextBlock: '',
      };
    }

    const graphMatches = this.#matchGraphEntities(cleanQuery);
    const localCandidates = this.#collectLocalCandidates(cleanQuery, graphMatches);
    const { grade, confidence } = this.evaluateCragConfidence(cleanQuery, localCandidates, graphMatches);

    let combined = [...localCandidates];
    let webUsed = false;
    let rewrittenQuery = null;

    const needsFallback = grade === 'INCORRECT' || (grade === 'AMBIGUOUS' && confidence < 0.6);
    if (needsFallback && useWebFallback && typeof this.fetchSearch === 'function') {
      rewrittenQuery = rewriteSearchQuery(cleanQuery);
      try {
        const webResults = await this.fetchSearch(rewrittenQuery || cleanQuery, limit);
        if (Array.isArray(webResults) && webResults.length > 0) {
          webUsed = true;
          const rwTokens = new Set(meaningfulTokens(rewrittenQuery || cleanQuery));
          for (let i = 0; i < webResults.length; i++) {
            const w = webResults[i];
            const text = [w.title, w.snippet || w.text].filter(Boolean).join(': ').trim();
            const wTokens = tokenize(text);
            const wSet = new Set(wTokens);
            let overlap = 0;
            for (const t of rwTokens) if (wSet.has(t)) overlap++;
            const score = rwTokens.size ? (overlap / Math.sqrt(rwTokens.size * Math.max(1, wSet.size))) + 0.35 : 0.4;
            combined.push({
              docId: `web-${i + 1}`,
              title: w.title || w.url || 'Web Result',
              url: w.url || '',
              source: 'web',
              yearTag: '2026',
              text,
              tokens: wTokens,
              tokenCoverage: rwTokens.size ? overlap / rwTokens.size : 0,
              graphBoost: 0,
              matchedEntities: [],
              score: Number(score.toFixed(3)),
            });
          }
          combined.sort((a, b) => b.score - a.score);
        }
      } catch {
        // Offline or network search error must not crash RAG retrieval
      }
    }

    const filterQuery = rewrittenQuery ? `${cleanQuery} ${rewrittenQuery}` : cleanQuery;
    const citations = this.#filterNoiseAndDedupe(filterQuery, combined, limit);

    const graphEntities = graphMatches.allMatched.map(n => ({
      id: n.id,
      label: n.label,
      hop: n.hop,
      via: n.via,
      score: Number(n.matchScore.toFixed(3)),
    }));

    const header = `[RAG Context | CRAG: ${grade} (${confidence}) | Web Fallback: ${webUsed ? 'yes' : 'no'}${rewrittenQuery ? ` | Query: ${rewrittenQuery}` : ''}]`;
    const entityLine = graphEntities.length
      ? `Graph Entities: ${graphEntities.map(e => `${e.label} (hop ${e.hop}${e.via ? `, ${e.via}` : ''})`).join('; ')}`
      : '';
    const snippetLines = citations.map((c, idx) => {
      const tagStr = c.tags.join(' ');
      const srcStr = c.url ? ` (${c.url})` : '';
      return `- [${idx + 1}] ${c.title}${srcStr} ${tagStr}: ${c.text}`;
    });
    const contextBlock = [header, entityLine, ...snippetLines].filter(Boolean).join('\n');

    return {
      query: cleanQuery,
      ...(rewrittenQuery ? { rewrittenQuery } : {}),
      grade,
      confidence,
      webUsed,
      citations,
      graphEntities,
      contextBlock,
    };
  }
}
