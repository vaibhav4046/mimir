// Context Graph Lab: the live demo. A small zero-dependency server in front of a HydraDB node.
//   HYDRA_URL=http://127.0.0.1:18443 PORT=7860 node app/server.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Bm25 } from '../src/bm25.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HydraStore, cell } from '../src/store-hydradb.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { setNamespace } from '../src/text.mjs';
import { createEmbedder } from '../src/embed-similar.mjs';
import { TOOLS, SERVERS, SKILLS, ENTITY_NAMES, TASKS, SIMILAR, bm25WithSkills, ALL_SCHEMA_CHARS, schemaChars } from '../bench/lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7860);
const embedder = process.env.EMBED === '0' ? null : createEmbedder();
const store = new HydraStore({ url: process.env.HYDRA_URL || 'http://127.0.0.1:18443', token: process.env.HYDRA_TOKEN || 'local-dev-auth-token-32-characters-long' });
const bm25 = bm25WithSkills();

const state = { ready: false, stage: 'starting', graph: null, examples: [], ns: '', learned: 0, seededAt: null, log: [] };
const say = m => {
  state.stage = m;
  console.error(new Date().toISOString().slice(11, 19), m);
};

async function waitForHydra() {
  for (let i = 0; i < 120; i++) {
    try {
      await store.init();
      return;
    } catch {
      say(`waiting for HydraDB (${i}s)`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('HydraDB never became ready');
}

async function build() {
  if (building) return;
  building = true;
  try {
    await buildGraph();
  } finally {
    building = false;
  }
}

async function buildGraph() {
  state.ready = false;
  await waitForHydra();
  // A fresh namespace per build: nothing from an earlier run can leave duplicate edges behind.
  state.ns = `demo-${Date.now().toString(36)}`;
  store.edgeCount = {};
  setNamespace(state.ns);
  say('seeding the graph in HydraDB');
  const g = new ContextGraph(store, { k: 6, embedBudgetMs: 40 });
  if (embedder) g.embedUnknown = embedder;
  await g.seed({ tools: TOOLS, skills: SKILLS, servers: SERVERS.map(s => s.name) });
  for (const name of ENTITY_NAMES) await g.registerEntity(name);
  say('adding semantic bridge edges');
  await g.loadSimilar(SIMILAR);
  if (embedder) await g.retrieve('qwertyuiop').catch(() => {}); // warm the embedder (anchor vectors) so the first visitor is not slow
  // Which example prompts does the untrained graph already get right? The page leads with those.
  state.examples = [];
  for (const t of TASKS.filter(x => x.split === 'test').filter((_, i) => i % 5 === 0)) {
    const r = await g.retrieve(t.text, { k: 6 });
    const ids = r.tools.map(x => x.id);
    state.examples.push({ text: t.text, kind: t.kind, tools: t.tools, hit: t.tools.every(x => ids.includes(x)), score: r.tools[0]?.score ?? 0, taught: false, reworded: TASKS.filter(o => o.capability === t.capability && o.split === 'train').map(o => o.text) });
  }
  state.examples.sort((x, y) => Number(y.hit) - Number(x.hit) || y.score - x.score);
  state.graph = g;
  state.learned = 0;
  state.seededAt = new Date().toISOString();
  state.ready = true;
  say('ready');
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(body));
};
const readBody = req =>
  new Promise((resolve, reject) => {
    let b = '';
    let over = false;
    req.on('data', c => {
      if (over) return;
      b += c;
      if (b.length > 20_000) {
        over = true;
        b = '';
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
      }
    });
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
  });

const hits = new Map();
const MAX_TRACKED_IPS = 5000;
const limited = ip => {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 10_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > MAX_TRACKED_IPS) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= 10_000) hits.delete(k);
    if (hits.size > MAX_TRACKED_IPS) hits.clear();
  }
  return list.length > 60;
};

// Behind a tunnel or proxy you control, set TRUST_PROXY=1 so the real client address is read from its header.
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// /api/reset wipes what visitors taught. It is off unless RESET_TOKEN is set, and then needs that token.
const RESET_TOKEN = process.env.RESET_TOKEN || '';
const STOPWORDS = new Set('a an and are as at be but by can could do for from has have how i if in into is it its me my of on or our please so than that the their them then there these they this to up us was we what when where which who will with would you your'.split(' '));
const FEEDBACK_PER_MIN = 6;
const feedbackHits = new Map();
const feedbackLimited = ip => {
  const now = Date.now();
  const list = (feedbackHits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  feedbackHits.set(ip, list);
  if (feedbackHits.size > 5000) feedbackHits.clear();
  return list.length > FEEDBACK_PER_MIN;
};
const RESET_COOLDOWN_MS = 60_000;
let lastResetAt = 0;
let building = false;
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
};

const toolMeta = new Map(TOOLS.map(t => [t.id, t]));

// ---------- private graphs: a visitor pastes their own MCP tool list ----------
let chain = Promise.resolve();
const serial = fn => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};
const customs = new Map(); // id -> { id, ns, graph, tools, meta, bm25, chars, preloadChars, learned }
const MAX_CUSTOM_GRAPHS = 30;
const MAX_CUSTOM_TOOLS = 150;
const customHits = new Map();
const customLimited = ip => {
  const now = Date.now();
  const list = (customHits.get(ip) || []).filter(t => now - t < 600_000);
  list.push(now);
  customHits.set(ip, list);
  if (customHits.size > 2000) customHits.clear();
  return list.length > 3;
};

/** Accept an MCP tools/list answer ({tools: [...]}) or a bare array. Returns a clean list, or an error string. */
function parseCustomTools(input) {
  let list = input;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return 'That is not valid JSON.';
    }
  }
  if (list && !Array.isArray(list) && Array.isArray(list.tools)) list = list.tools;
  if (!Array.isArray(list)) return 'Paste a JSON list of tools: [{"name": "...", "description": "..."}, ...] or an MCP tools/list answer.';
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const name = typeof raw?.name === 'string' ? raw.name.trim().slice(0, 80) : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const description = typeof raw.description === 'string' ? raw.description.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) : '';
    const size = JSON.stringify({ name, description, inputSchema: raw.inputSchema ?? raw.input_schema ?? raw.parameters ?? null }).length;
    out.push({ id: name, description, server: name.split(/__|\.|:|\//)[0] || 'custom', size: Math.min(size, 4000) });
  }
  if (out.length < 3) return 'Add at least three tools, each with a name and a description.';
  if (out.length > MAX_CUSTOM_TOOLS) return `This demo builds graphs of up to ${MAX_CUSTOM_TOOLS} tools; you pasted ${out.length}.`;
  return out;
}

async function buildCustom(list) {
  const id = crypto.randomBytes(6).toString('hex');
  const ns = `byo-${id}`;
  setNamespace(ns);
  const graph = new ContextGraph(store, { k: 6, embedBudgetMs: 40 });
  if (embedder) graph.embedUnknown = embedder;
  await graph.seed({ tools: list, skills: [], servers: [...new Set(list.map(t => t.server))] });
  const entry = {
    id, ns, graph, tools: list, learned: 0,
    meta: new Map(list.map(t => [t.id, t])),
    chars: new Map(list.map(t => [t.id, t.size])),
    preloadChars: list.reduce((s, t) => s + t.size, 0),
    bm25: new Bm25(list.map(t => ({ id: t.id, text: `${t.id.replace(/__/g, ' ').replace(/_/g, ' ')} ${t.description}` }))),
  };
  customs.set(id, entry);
  while (customs.size > MAX_CUSTOM_GRAPHS) customs.delete(customs.keys().next().value);
  return entry;
}

function viewCustom(c, r, text) {
  const ids = r.tools.map(t => t.id);
  const bm = c.bm25.search(text, 6).map(x => x.id);
  const chars = list => list.reduce((s, id) => s + (c.chars.get(id) || 290), 0);
  return {
    ...r,
    tools: r.tools.map(t => ({ ...t, server: c.meta.get(t.id)?.server, description: c.meta.get(t.id)?.description })),
    compare: {
      catalogTools: c.tools.length,
      preloadChars: c.preloadChars,
      preloadTokens: Math.round(c.preloadChars / 4),
      pulledChars: chars(ids),
      pulledTokens: Math.round(chars(ids) / 4),
      keywordSearchPicks: bm,
      keywordSearchTokens: Math.round(chars(bm) / 4),
    },
  };
}
const bodyOf = b => (b && typeof b === 'object' && !Array.isArray(b) ? b : {});
const clean = s => (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300);

function view(r, text) {
  const ids = r.tools.map(t => t.id);
  const bm = bm25.search(text, 6).map(x => x.id);
  return {
    ...r,
    tools: r.tools.map(t => ({ ...t, server: toolMeta.get(t.id)?.server, description: toolMeta.get(t.id)?.description })),
    compare: {
      catalogTools: TOOLS.length,
      preloadChars: ALL_SCHEMA_CHARS,
      preloadTokens: Math.round(ALL_SCHEMA_CHARS / 4),
      pulledChars: schemaChars(ids),
      pulledTokens: Math.round(schemaChars(ids) / 4),
      keywordSearchPicks: bm,
      keywordSearchTokens: Math.round(schemaChars(bm) / 4),
    },
  };
}

const edgeCounts = async () => ({ MENTIONS: 0, REQUIRES: 0, SERVES: 0, RESOLVES_TO: 0, SIMILAR: 0, NEXT: 0, ...store.edgeCount });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp4': 'video/mp4', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
function serveStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  let rel;
  try {
    rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  } catch {
    return json(res, 400, { error: 'Bad path' });
  }
  const root = path.resolve(ROOT, 'public');
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return json(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Not found' });
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const ip = TRUST_PROXY ? String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']?.split(',').pop() || '').trim() || req.socket.remoteAddress || '' : req.socket.remoteAddress || '';
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (limited(ip)) return json(res, 429, { error: 'Slow down a little.' });
      if (url.pathname === '/api/status') return json(res, 200, { ready: state.ready, stage: state.stage, learned: state.learned, seededAt: state.seededAt });
      if (!state.ready) return json(res, 503, { error: 'The graph is still loading into HydraDB.', stage: state.stage });
      const body = req.method === 'POST' ? await readBody(req) : {};
      // One request at a time touches the graph: the node-id salt is a module-level setting, so interleaved
      // requests for different graphs could otherwise hash ids with the wrong one.
      return serial(async () => {
      setNamespace(state.ns);

      if (req.method === 'GET' && url.pathname === '/api/info') {
        return json(res, 200, {
          catalog: { tools: TOOLS.length, servers: SERVERS.length, skills: SKILLS.length, realMimirTools: TOOLS.filter(t => t.real).length, schemaChars: ALL_SCHEMA_CHARS, schemaTokens: Math.round(ALL_SCHEMA_CHARS / 4) },
          edges: await edgeCounts(),
          learned: state.learned,
          hydra: { requests: store.requests, p50ms: pctl(store.latencies.slice(-400), 0.5), p95ms: pctl(store.latencies.slice(-400), 0.95) },
          examples: state.examples,
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/tools') {
        return json(res, 200, TOOLS.map(t => ({ id: t.id, server: t.server, description: t.description })));
      }
      if (req.method === 'GET' && url.pathname === '/api/results') {
        const f = path.resolve(ROOT, '..', 'results', 'results.json');
        return fs.existsSync(f) ? json(res, 200, JSON.parse(fs.readFileSync(f, 'utf8'))) : json(res, 404, { error: 'No benchmark results yet' });
      }
      if (req.method === 'POST' && url.pathname === '/api/custom') {
        if (customLimited(ip)) return json(res, 429, { error: 'You can build a few private graphs per ten minutes. Try again shortly.' });
        const list = parseCustomTools(body.tools ?? body);
        if (typeof list === 'string') return json(res, 400, { error: list });
        const entry = await buildCustom(list);
        return json(res, 200, { id: entry.id, tools: entry.tools.map(t => ({ id: t.id, server: t.server, description: t.description })), preloadTokens: Math.round(entry.preloadChars / 4) });
      }
      if (req.method === 'POST' && url.pathname === '/api/retrieve') {
        const { text, k, graph } = bodyOf(body);
        const t = clean(text);
        if (t.length < 3) return json(res, 400, { error: 'Type a task first.' });
        const c = graph ? customs.get(String(graph)) : null;
        if (graph && !c) return json(res, 404, { error: 'That private graph has expired. Build it again.' });
        if (c) setNamespace(c.ns);
        const r = await (c ? c.graph : state.graph).retrieve(t, { k: Math.min(12, Math.max(1, Number(k) || 6)) });
        return json(res, 200, c ? viewCustom(c, r, t) : view(r, t));
      }
      if (req.method === 'POST' && url.pathname === '/api/feedback') {
        if (feedbackLimited(ip)) return json(res, 429, { error: 'That is a lot of lessons at once. Try again in a minute.' });
        const { text, used, graph } = bodyOf(body);
        const t = clean(text).split(/\s+/).filter(w => !STOPWORDS.has(w.toLowerCase())).join(' ');
        const c = graph ? customs.get(String(graph)) : null;
        if (graph && !c) return json(res, 404, { error: 'That private graph has expired. Build it again.' });
        const meta = c ? c.meta : toolMeta;
        const g = c ? c.graph : state.graph;
        const ids = (Array.isArray(used) ? used : []).filter(u => meta.has(u)).slice(0, 6);
        if (t.length < 3 || !ids.length) return json(res, 400, { error: 'Pick at least one tool that the task really needed.' });
        if (c) setNamespace(c.ns);
        const before = await g.retrieve(t);
        const stats = await g.learn({ text: t, used: ids, retrieved: before.tools.map(x => x.id) });
        if (c) c.learned += 1;
        else {
          state.learned += 1;
          for (const e of state.examples) if (e.text.toLowerCase() === clean(text).toLowerCase()) e.taught = true;
        }
        const after = await g.retrieve(t);
        return json(res, 200, { learned: stats, before: c ? viewCustom(c, before, t) : view(before, t), after: c ? viewCustom(c, after, t) : view(after, t), examples: c ? c.learned : state.learned });
      }
      if (req.method === 'POST' && url.pathname === '/api/reset') {
        if (!RESET_TOKEN || req.headers['x-reset-token'] !== RESET_TOKEN) return json(res, 403, { error: 'Reset is disabled on this demo.' });
        const wait = RESET_COOLDOWN_MS - (Date.now() - lastResetAt);
        if (building || wait > 0) return json(res, 429, { error: `Someone just reset the demo. Try again in ${Math.max(1, Math.ceil(wait / 1000))}s.` });
        lastResetAt = Date.now();
        build().catch(e => say(`reset failed: ${e.message}`));
        return json(res, 202, { started: true });
      }
      return json(res, 404, { error: 'Unknown route' });
      });
    }
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('request failed:', err.message);
    if (err.status === 413) res.once('finish', () => req.destroy());
    return json(res, err.status || 500, { error: err.status ? err.message : 'Something went wrong.' });
  }
});

function pctl(a, p) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
}

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(PORT, '0.0.0.0', () => console.error(`Context Graph Lab on http://127.0.0.1:${PORT}`));
build().catch(e => say(`FAILED: ${e.message}`));
