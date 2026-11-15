import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RagEngine } from './rag-engine.mjs';

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripHtmlTags(html) {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function unwrapDdgHref(rawHref) {
  const href = decodeHtmlEntities(rawHref);
  try {
    const abs = href.startsWith('//') ? `https:${href}` : href.startsWith('/') ? `https://duckduckgo.com${href}` : href;
    const u = new URL(abs);
    const uddg = u.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : u.toString();
  } catch {
    return href;
  }
}

export async function fetchLiveSearch(query, maxResults = 6) {
  const q = String(query || '').trim();
  if (!q) return [];
  const cap = Math.max(1, Math.min(Number(maxResults) || 6, 12));

  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const html = await res.text();
      const blocks = html.split(/class="result\s/gi).slice(1);
      const out = [];
      for (const blk of blocks) {
        if (out.length >= cap) break;
        const aMatch = blk.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!aMatch) continue;
        const snipMatch = blk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
        const url = unwrapDdgHref(aMatch[1]);
        const title = stripHtmlTags(aMatch[2]);
        const snippet = stripHtmlTags(snipMatch?.[1] || snipMatch?.[2] || '');
        if (title && url.startsWith('http')) {
          out.push({ title, url, snippet, engine: 'duckduckgo' });
        }
      }
      if (out.length > 0) return out;
    }
  } catch {
    // Fall through to Wikipedia OpenSearch
  }

  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=${cap}&format=json`;
    const res = await fetch(wikiUrl, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json();
      const titles = data?.[1] || [];
      const descs = data?.[2] || [];
      const urls = data?.[3] || [];
      return titles.map((t, i) => ({
        title: String(t),
        url: String(urls[i] || ''),
        snippet: String(descs[i] || ''),
        engine: 'wikipedia-opensearch',
      }));
    }
  } catch {
    // Return empty array cleanly
  }
  return [];
}

export async function fetchMultiEngineSearch(query, maxResults = 8) {
  const q = String(query || '').trim();
  if (!q) return [];
  const cap = Math.max(1, Math.min(Number(maxResults) || 8, 16));
  const [webRes, hnRes] = await Promise.allSettled([
    fetchLiveSearch(q, cap),
    fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=4`, {
      signal: AbortSignal.timeout(7000),
    }).then(r => (r.ok ? r.json() : null)),
  ]);

  const combined = [];
  const seen = new Set();
  const pushHit = item => {
    const url = String(item?.url || '').trim();
    if (!url.startsWith('http')) return;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    combined.push(item);
  };

  if (webRes.status === 'fulfilled' && Array.isArray(webRes.value)) {
    for (const h of webRes.value) pushHit(h);
  }
  if (hnRes.status === 'fulfilled' && Array.isArray(hnRes.value?.hits)) {
    for (const hit of hnRes.value.hits) {
      const url = hit.url || (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : '');
      const title = String(hit.title || '').trim();
      if (!title || !url) continue;
      pushHit({
        title,
        url,
        snippet: `HN story (${Number(hit.points || 0)} pts, ${Number(hit.num_comments || 0)} comments): ${title}`,
        engine: 'hn-algolia',
      });
    }
  }
  return combined.slice(0, cap);
}

export async function fetchUrlText(rawUrl) {
  const u = new URL(String(rawUrl));
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error(`Unsupported URL protocol: ${u.protocol}`);
  }
  const res = await fetch(u.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'text/html,text/plain,application/json',
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${u.toString()}`);
  }
  const ctype = res.headers.get('content-type') || '';
  const raw = await res.text();
  if (ctype.includes('json')) {
    return { url: res.url, title: u.hostname, text: raw.slice(0, 20000) };
  }
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripHtmlTags(titleMatch?.[1] || u.hostname);
  const text = stripHtmlTags(raw).slice(0, 20000);
  return { url: res.url, title, text };
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(' ')
    .filter(w => w.length >= 2);
}

export function chunkText(text, chunkSize = 550, overlap = 80) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  let idx = 0;
  while (idx < clean.length && chunks.length < 24) {
    chunks.push(clean.slice(idx, idx + chunkSize));
    if (idx + chunkSize >= clean.length) break;
    idx += chunkSize - overlap;
  }
  return chunks;
}

export class KnowledgeBase {
  constructor(dataDir, opts = {}) {
    this.dir = path.join(dataDir, 'rsi');
    fs.mkdirSync(this.dir, { recursive: true });
    this.filePath = path.join(this.dir, 'knowledge.json');
    this.data = this.#load();
    this.rag = new RagEngine({
      knowledgeBase: this,
      knowledgeDir: this.dir,
      ...(opts.fetchSearch ? { fetchSearch: opts.fetchSearch } : {}),
    });
    if (opts.autoIndexGraph !== false && this.data.docs.length > 0) {
      this.rag.indexGraphFromDocs();
    }
  }

  #load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (Array.isArray(parsed?.docs)) return parsed;
      }
    } catch {
      // ignore corrupted file
    }
    return { docs: [] };
  }

  #save() {
    const payload = JSON.stringify(this.data, null, 2);
    const tmp = `${this.filePath}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    try {
      fs.renameSync(tmp, this.filePath);
    } catch {
      fs.writeFileSync(this.filePath, payload, 'utf8');
      try { fs.unlinkSync(tmp); } catch {}
    }
  }

  listDocs() {
    return this.data.docs.map(d => ({
      id: d.id,
      title: d.title,
      source: d.source,
      url: d.url,
      yearTag: d.yearTag,
      fetchedAt: d.fetchedAt,
      chunkCount: d.chunks?.length || 0,
      preview: d.chunks?.[0]?.text?.slice(0, 180) || '',
    }));
  }

  ingestDocument({ title, source = 'manual', url = '', content, yearTag = '2026', skipSave = false }) {
    const rawChunks = chunkText(content);
    if (!rawChunks.length) return { doc: null, chunksAdded: 0, updated: false };
    const cleanTitle = String(title || 'Untitled Note').trim().slice(0, 140);
    const cleanUrl = String(url || '').trim();
    const contentSha = crypto.createHash('sha256').update(String(content || '')).digest('hex');
    const normTitle = cleanTitle.toLowerCase();
    const normUrl = cleanUrl.toLowerCase();

    const existingIdx = this.data.docs.findIndex(d => {
      if (d.contentSha && d.contentSha === contentSha) return true;
      if (normUrl && d.url && d.url.toLowerCase() === normUrl && String(d.title || '').toLowerCase() === normTitle) return true;
      return !normUrl && !d.url && String(d.title || '').toLowerCase() === normTitle;
    });

    const mappedChunks = rawChunks.map(text => ({ text, tokens: tokenize(text).slice(0, 90) }));
    const now = new Date().toISOString();

    if (existingIdx >= 0) {
      const existing = this.data.docs[existingIdx];
      existing.title = cleanTitle;
      existing.source = String(source);
      existing.url = cleanUrl;
      existing.yearTag = String(yearTag || '2026');
      existing.fetchedAt = now;
      existing.contentSha = contentSha;
      existing.chunks = mappedChunks;
      if (!skipSave) this.#save();
      this.rag?.upsertDocumentGraph?.(existing, { skipSave });
      const view = this.listDocs().find(d => d.id === existing.id) || null;
      return { doc: view, chunksAdded: mappedChunks.length, updated: true };
    }

    const doc = {
      id: `kdoc-${crypto.randomBytes(4).toString('hex')}`,
      title: cleanTitle,
      source: String(source),
      url: cleanUrl,
      yearTag: String(yearTag || '2026'),
      fetchedAt: now,
      contentSha,
      chunks: mappedChunks,
    };
    this.data.docs.unshift(doc);
    if (this.data.docs.length > 500) this.data.docs.length = 500;
    if (!skipSave) this.#save();
    this.rag?.upsertDocumentGraph?.(doc, { skipSave });
    return { doc: this.listDocs()[0], chunksAdded: doc.chunks.length, updated: false };
  }

  ingestBatch(docs = []) {
    let docsAdded = 0;
    let docsUpdated = 0;
    let chunksAdded = 0;
    for (const item of Array.isArray(docs) ? docs : []) {
      if (!item || !String(item.content || '').trim()) continue;
      const res = this.ingestDocument({ ...item, skipSave: true });
      if (res.chunksAdded > 0) {
        chunksAdded += res.chunksAdded;
        if (res.updated) docsUpdated += 1;
        else docsAdded += 1;
      }
    }
    if (docsAdded > 0 || docsUpdated > 0) {
      this.#save();
      this.rag?.saveGraph?.();
    }
    return {
      docsAdded,
      docsUpdated,
      chunksAdded,
      totalDocs: this.data.docs.length,
      graph: this.getGraphSummary(),
    };
  }

  async ingestFromWebQuery(query, maxResults = 5) {
    const results = await fetchLiveSearch(query, maxResults);
    if (!results.length) return { query, results: [], indexedDocs: 0 };

    const digest = results
      .map((r, i) => `[${i + 1}] ${r.title} (${r.url}): ${r.snippet}`)
      .join('\n');
    let indexedDocs = 0;
    const digestRes = this.ingestDocument({
      title: `2026 Live Search: ${query}`,
      source: 'live-web-search',
      url: results[0]?.url || '',
      content: digest,
      yearTag: '2026',
    });
    if (digestRes.chunksAdded > 0) indexedDocs++;

    // Try ingesting full text of top readable result for richer RAG grounding
    if (results[0]?.url) {
      try {
        const page = await fetchUrlText(results[0].url);
        if (page.text.length > 200) {
          const fullRes = this.ingestDocument({
            title: page.title || results[0].title,
            source: 'live-web-page',
            url: page.url,
            content: page.text,
            yearTag: '2026',
          });
          if (fullRes.chunksAdded > 0) indexedDocs++;
        }
      } catch {
        // Search snippet digest is already indexed
      }
    }
    return { query, results, indexedDocs };
  }

  deleteDoc(id) {
    const before = this.data.docs.length;
    this.data.docs = this.data.docs.filter(d => d.id !== id);
    this.#save();
    if (this.data.docs.length < before) {
      this.rag?.removeDocumentGraph?.(id);
      return true;
    }
    return false;
  }

  getGraphSummary() {
    return this.rag.getGraphSummary();
  }

  async queryWithRag(queryText, opts = {}) {
    const options = typeof opts === 'number' ? { topK: opts } : (opts || {});
    return this.rag.retrieve({ query: queryText, ...options });
  }

  query(queryText, topK = 4) {
    const qTokens = tokenize(queryText);
    if (!qTokens.length || !this.data.docs.length) return [];
    const qSet = new Set(qTokens);
    const scored = [];

    for (const doc of this.data.docs) {
      const recencyBoost = doc.yearTag === '2026' ? 1.25 : 1.0;
      for (const ch of doc.chunks || []) {
        let overlap = 0;
        for (const tok of ch.tokens || []) {
          if (qSet.has(tok)) overlap++;
        }
        if (overlap > 0) {
          const score = (overlap / Math.sqrt((ch.tokens?.length || 1) + 4)) * recencyBoost;
          scored.push({
            docId: doc.id,
            title: doc.title,
            url: doc.url,
            yearTag: doc.yearTag,
            fetchedAt: doc.fetchedAt,
            score: Number(score.toFixed(3)),
            text: ch.text,
          });
        }
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

export async function queryWithRag(knowledge, queryText, opts = {}) {
  if (knowledge && typeof knowledge.queryWithRag === 'function') {
    return knowledge.queryWithRag(queryText, opts);
  }
  if (knowledge && typeof knowledge === 'object' && 'query' in knowledge) {
    const kb = knowledge.knowledgeBase || knowledge.knowledge || null;
    const engine = knowledge.ragEngine || kb?.rag || new RagEngine({ knowledgeBase: kb, knowledgeDir: kb?.dir });
    return engine.retrieve({ topK: 5, useWebFallback: true, ...knowledge });
  }
  throw new Error('queryWithRag requires a KnowledgeBase instance');
}

export class RsiPipeline {
  constructor(dataDir, store, knowledge) {
    this.dir = path.join(dataDir, 'rsi');
    fs.mkdirSync(this.dir, { recursive: true });
    this.store = store;
    this.knowledge = knowledge;
    this.rulesPath = path.join(this.dir, 'rules.json');
    this.sftPath = path.join(this.dir, 'sft-dataset.jsonl');
    this.dpoPath = path.join(this.dir, 'dpo-pairs.jsonl');
    this.rules = this.#loadRules();
  }

  #loadRules() {
    try {
      if (fs.existsSync(this.rulesPath)) {
        const arr = JSON.parse(fs.readFileSync(this.rulesPath, 'utf8'));
        if (Array.isArray(arr)) return arr;
      }
    } catch {
      // ignore
    }
    return [];
  }

  #saveRules() {
    const tmp = `${this.rulesPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.rules, null, 2), 'utf8');
    fs.renameSync(tmp, this.rulesPath);
  }

  listRules(botId = null) {
    return botId ? this.rules.filter(r => !r.botId || r.botId === botId) : this.rules;
  }

  addRule({ botId = '', toolName = 'general', pattern = '', lesson, evidence = '' }) {
    const cleanLesson = String(lesson || '').trim();
    if (!cleanLesson) return null;
    const existing = this.rules.find(
      r => r.lesson.toLowerCase() === cleanLesson.toLowerCase() && (r.botId || '') === (botId || '')
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.hits = (existing.hits || 1) + 1;
      existing.updatedAt = now;
      if (evidence) existing.evidence = String(evidence).slice(0, 240);
      this.#saveRules();
      return existing;
    }
    const rule = {
      id: `rsi-${crypto.randomBytes(4).toString('hex')}`,
      botId: botId || '',
      toolName: String(toolName || 'general'),
      pattern: String(pattern || '').slice(0, 120),
      lesson: cleanLesson.slice(0, 320),
      evidence: String(evidence || '').slice(0, 240),
      hits: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rules.unshift(rule);
    if (this.rules.length > 80) this.rules.length = 80;
    this.#saveRules();
    return rule;
  }

  deleteRule(id) {
    const before = this.rules.length;
    this.rules = this.rules.filter(r => r.id !== id);
    this.#saveRules();
    return this.rules.length < before;
  }

  critiqueToolFailure({ bot, toolName, args, errorOutput }) {
    const err = String(errorOutput || '');
    let pattern = 'tool-failure';
    let lesson = '';
    let correctiveHint = '';

    if (/ERR_NAME_NOT_RESOLVED|Invalid URL/i.test(err)) {
      pattern = 'invalid-browser-url';
      lesson = 'For web discovery use browser_search(query) first or pass a full domain (e.g. https://example.com), never bare site names without a TLD unless searching.';
      correctiveHint = 'Call browser_search with your search terms instead of guessing a bare domain URL.';
    } else if (/waiting for locator|Timeout.*exceeded|selector/i.test(err)) {
      pattern = 'ungrounded-selector';
      lesson = 'Never invent CSS selectors from memory. Inspect interactiveElements returned by browser_open/browser_action and click/type using an exact returned selector or browser_search.';
      correctiveHint = 'Use browser_search for web queries, OR inspect exact interactiveElements selectors returned by browser_open instead of guessing selector IDs.';
    } else if (/CAPTCHA|verify you are human|unusual traffic/i.test(err)) {
      pattern = 'captcha-blocked';
      lesson = 'When a website blocks headless automation with a CAPTCHA, stop retrying the same CAPTCHA page and either use browser_search or ask the user to sign in using "Own Computer" browser mode.';
      correctiveHint = 'Do not bypass CAPTCHA. Use browser_search or explain to the user they can switch Preview Mode to Own Computer to complete verification.';
    } else if (/Path traversal|Outside workspace/i.test(err)) {
      pattern = 'workspace-path-boundary';
      lesson = 'Always pass paths relative to the bot sandbox workspace (e.g. "notes/report.md"), never absolute OS paths like C:\\...';
      correctiveHint = 'Retry using a relative path inside the workspace root.';
    } else {
      const cleanErr = err
        .replace(/^ERROR:\s*/i, '')
        .replace(/[A-Za-z]:\\[^\s'"`]*\\sandboxes\\[^\\'"`]+/gi, '<workspace>')
        .replace(/\/[^\s'"`]*\/sandboxes\/[^/\s'"`]+/gi, '<workspace>')
        .slice(0, 140);
      lesson = `Avoid repeating failed ${toolName} pattern (${cleanErr}). Verify path/arguments relative to <workspace> first.`;
      correctiveHint = `The previous ${toolName} call failed. Read the error details carefully and adjust parameters or pick a more reliable tool.`;
    }

    const rule = this.addRule({
      botId: bot?.id || '',
      toolName,
      pattern,
      lesson,
      evidence: `args=${JSON.stringify(args).slice(0, 100)} -> ${err.slice(0, 140)}`,
    });
    return { rule, correctiveHint };
  }

  recordRunDatasets({ bot, userText, assistantReply, hadToolError = false, rejectedAttempt = '' }) {
    const cleanUser = String(userText || '').trim();
    const cleanReply = String(assistantReply || '').trim();
    if (!cleanUser || !cleanReply || cleanReply.startsWith('Error:')) return { recordedSft: false, recordedDpo: false };

    const sftRecord = {
      messages: [
        { role: 'system', content: bot?.systemPrompt || 'You are Mimir, a helpful autonomous local assistant.' },
        { role: 'user', content: cleanUser },
        { role: 'assistant', content: cleanReply },
      ],
      metadata: {
        botId: bot?.id || '',
        botName: bot?.name || 'Mimir',
        model: bot?.modelOverride || 'default',
        timestamp: new Date().toISOString(),
        recoveredFromError: Boolean(hadToolError),
      },
    };
    fs.appendFileSync(this.sftPath, `${JSON.stringify(sftRecord)}\n`, 'utf8');

    let recordedDpo = false;
    if (hadToolError && rejectedAttempt) {
      const dpoRecord = {
        prompt: cleanUser,
        chosen: cleanReply,
        rejected: String(rejectedAttempt).slice(0, 2000),
        metadata: { botId: bot?.id || '', timestamp: new Date().toISOString() },
      };
      fs.appendFileSync(this.dpoPath, `${JSON.stringify(dpoRecord)}\n`, 'utf8');
      recordedDpo = true;
    }
    return { recordedSft: true, recordedDpo };
  }

  readJsonlTail(filePath, limit = 20) {
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).reverse().map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }

  getStats(botId = null) {
    const sftCount = fs.existsSync(this.sftPath) ? fs.readFileSync(this.sftPath, 'utf8').split(/\r?\n/).filter(Boolean).length : 0;
    const dpoCount = fs.existsSync(this.dpoPath) ? fs.readFileSync(this.dpoPath, 'utf8').split(/\r?\n/).filter(Boolean).length : 0;
    const docs = this.knowledge.listDocs();
    return {
      rulesCount: this.listRules(botId).length,
      sftCount,
      dpoCount,
      knowledgeDocs: docs.length,
      knowledgeChunks: docs.reduce((a, d) => a + d.chunkCount, 0),
      graph: this.knowledge.getGraphSummary?.() || null,
      sftPath: this.sftPath,
      dpoPath: this.dpoPath,
    };
  }

  buildModelfileSpec({ bot, settings, baseModel, targetModelName }) {
    const base = baseModel || bot?.modelOverride || settings?.ollamaModel || 'qwen3:1.7b';
    const target = (targetModelName || 'mimir-rsi:latest').replace(/[^a-zA-Z0-9._:-]/g, '-');
    const topRules = this.listRules(bot?.id).slice(0, 12).map((r, i) => `${i + 1}. ${r.lesson}`).join('\n');
    const recentKnowledge = this.knowledge.listDocs().slice(0, 5).map(d => `- [${d.yearTag}] ${d.title}`).join('\n');
    const systemText = [
      bot?.systemPrompt || 'You are Mimir, a grounded desktop and browser autonomous assistant.',
      'Runtime Grounding Mandate: Always rely on live 2026 tool observations and returned interactiveElements rather than pre-cutoff assumptions.',
      topRules ? `Distilled Self-Improvement Rules:\n${topRules}` : '',
      recentKnowledge ? `Recent Live Knowledge Topics:\n${recentKnowledge}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
      .replace(/"""/g, '\\"\\"\\"');

    const modelfile = [
      `FROM ${base}`,
      `PARAMETER temperature 0.25`,
      `PARAMETER num_ctx 8192`,
      `SYSTEM """${systemText}"""`,
    ].join('\n');

    return { base, target, systemText, modelfile };
  }

  async compileDistilledModel({ bot, settings, baseModel, targetModelName }) {
    const spec = this.buildModelfileSpec({ bot, settings, baseModel, targetModelName });
    const baseUrl = String(settings?.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');

    // Modern Ollama >= 0.5 /api/create schema uses { model, from, system, parameters, stream: false }
    const res = await fetch(`${baseUrl}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: spec.target,
        from: spec.base,
        system: spec.systemText,
        parameters: { temperature: 0.25, num_ctx: 8192 },
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      const payload = await res.json().catch(() => ({ status: 'success' }));
      return { ok: true, modelName: spec.target, baseModel: spec.base, modelfile: spec.modelfile, ollamaResponse: payload };
    }

    // Legacy Ollama fallback { name, modelfile, stream: false }
    const legacyRes = await fetch(`${baseUrl}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: spec.target, modelfile: spec.modelfile, stream: false }),
      signal: AbortSignal.timeout(30000),
    });
    if (!legacyRes.ok) {
      const errTxt = await legacyRes.text().catch(() => '');
      throw new Error(`Ollama /api/create failed (${legacyRes.status}): ${errTxt.slice(0, 200)}`);
    }
    const payload = await legacyRes.json().catch(() => ({ status: 'success' }));
    return { ok: true, modelName: spec.target, baseModel: spec.base, modelfile: spec.modelfile, ollamaResponse: payload };
  }

  async pullOllamaModel({ settings, model }) {
    const cleanModel = String(model || '').trim();
    if (!cleanModel) throw new Error('Model name is required to pull');
    const baseUrl = String(settings?.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cleanModel, stream: false }),
      signal: AbortSignal.timeout(300000),
    });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => '');
      throw new Error(`Ollama pull failed (${res.status}): ${errTxt.slice(0, 200)}`);
    }
    return { ok: true, model: cleanModel, result: await res.json().catch(() => ({ status: 'success' })) };
  }
}
