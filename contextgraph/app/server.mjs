// Context Graph Lab: the live demo. A small zero-dependency server in front of a HydraDB node.
//   HYDRA_URL=http://127.0.0.1:18443 PORT=7860 node app/server.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HydraStore, cell } from '../src/store-hydradb.mjs';
import { ContextGraph } from '../src/graph.mjs';
import { setNamespace } from '../src/text.mjs';
import { TOOLS, SERVERS, SKILLS, ENTITY_NAMES, TASKS, SIMILAR, bm25WithSkills, ALL_SCHEMA_CHARS, schemaChars } from '../bench/lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7860);
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
  const g = new ContextGraph(store, { k: 6 });
  await g.seed({ tools: TOOLS, skills: SKILLS, servers: SERVERS.map(s => s.name) });
  for (const name of ENTITY_NAMES) await g.registerEntity(name);
  say('adding semantic bridge edges');
  await g.loadSimilar(SIMILAR);
  // Which example prompts does the untrained graph already get right? The page leads with those.
  state.examples = [];
  for (const t of TASKS.filter(x => x.split === 'test').filter((_, i) => i % 5 === 0)) {
    const ids = (await g.retrieve(t.text, { k: 6 })).tools.map(x => x.id);
    state.examples.push({ text: t.text, kind: t.kind, tools: t.tools, hit: t.tools.every(x => ids.includes(x)) });
  }
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
      if (req.method === 'POST' && url.pathname === '/api/retrieve') {
        const { text, k } = bodyOf(await readBody(req));
        const t = clean(text);
        if (t.length < 3) return json(res, 400, { error: 'Type a task first.' });
        const r = await state.graph.retrieve(t, { k: Math.min(12, Math.max(1, Number(k) || 6)) });
        return json(res, 200, view(r, t));
      }
      if (req.method === 'POST' && url.pathname === '/api/feedback') {
        if (feedbackLimited(ip)) return json(res, 429, { error: 'That is a lot of lessons at once. Try again in a minute.' });
        const { text, used } = bodyOf(await readBody(req));
        const t = clean(text).split(/s+/).filter(w => !STOPWORDS.has(w.toLowerCase())).join(' ');
        const ids = (Array.isArray(used) ? used : []).filter(u => toolMeta.has(u)).slice(0, 6);
        if (t.length < 3 || !ids.length) return json(res, 400, { error: 'Pick at least one tool that the task really needed.' });
        const before = await state.graph.retrieve(t);
        const stats = await state.graph.learn({ text: t, used: ids, retrieved: before.tools.map(x => x.id) });
        state.learned += 1;
        const after = await state.graph.retrieve(t);
        return json(res, 200, { learned: stats, before: view(before, t), after: view(after, t), examples: state.learned });
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
