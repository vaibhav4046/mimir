import { lineChart, barChart } from './charts.js';
import { renderDeck } from './deck.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const main = $('#main');
const fmt = n => Number(n).toLocaleString('en-US');

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

// ---------- status pill ----------
let ready = false;
async function pollStatus() {
  const pill = $('#statusPill');
  try {
    const s = await api('/api/status');
    ready = s.ready;
    pill.className = `pill ${s.ready ? 'ok' : ''}`;
    $('span', pill).textContent = s.ready ? `HydraDB live · ${s.learned} tasks learned` : `Loading graph into HydraDB: ${s.stage}`;
  } catch {
    pill.className = 'pill bad';
    $('span', pill).textContent = 'Server unreachable';
  }
  setTimeout(pollStatus, ready ? 8000 : 1500);
}

// ---------- router ----------
const routes = { '': lab, '/': lab, '/results': results, '/how': how, '/deck': renderDeck };
function route() {
  const hash = location.hash.replace(/^#/, '').split('?')[0];
  const key = hash.split('/').slice(0, 2).join('/');
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#${key}` || (key === '' && a.dataset.nav === 'lab')));
  (routes[hash] || routes[key] || lab)(main);
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

// ---------- Lab ----------
const WHY = {
  word: w => `word “${w.word}”`,
  similar: w => `“${w.word}” means “${w.meansWord}”`,
  skill: w => `skill: ${w.skill}`,
  entity: w => `${w.entity} lives in this system`,
  'used-with': w => `used with ${w.tool}`,
};
const cls = k => (k === 'skill' ? 'skill' : k === 'entity' ? 'entity' : k === 'similar' ? 'similar' : k === 'used-with' ? 'used' : '');

async function lab(root) {
  root.innerHTML = `<div class="wrap">
    <section class="hero">
      <div>
        <div class="eyebrow">Agent context layer · built on HydraDB</div>
        <h1>Your agent shouldn’t read 264 tool manuals before it reads your request.</h1>
        <p class="lede">Context Graph keeps an agent’s tools, skills and the things it already knows in a graph database. For each task it walks the graph and pulls only what the task needs, then gets sharper every time it is told what worked.</p>
      </div>
      <div class="counter" aria-live="polite">
        <div class="barlabel"><span>Tools the agent has</span><span>Tools it needs for this task</span></div>
        <div class="big"><span class="n1" id="n1">264</span><span class="arrow">→</span><span class="n2" id="n2">?</span></div>
        <div class="bars">
          <div><div class="barlabel"><span>Preload everything</span><span id="preTok">…</span></div><div class="bar pre"><i id="preBar" style="width:100%"></i></div></div>
          <div><div class="barlabel"><span>Pulled from the graph</span><span id="pullTok">ask something below</span></div><div class="bar pull"><i id="pullBar" style="width:0%"></i></div></div>
        </div>
        <div class="muted mono" id="meta" style="font-size:12.5px"> </div>
      </div>
    </section>

    <form class="ask" id="askForm" autocomplete="off">
      <label for="q" class="eyebrow" style="margin:0">What should your agent do?</label>
      <div class="askrow"><input id="q" maxlength="300" placeholder="e.g. Block two hours on Friday for planning" aria-describedby="hint"><button class="btn" id="go">Find the tools</button></div>
      <div class="chips" id="chips" aria-label="Example tasks"></div>
      <div class="muted" id="hint" style="font-size:13.5px">These examples were never used to train the graph. Try your own wording too.</div>
    </form>

    <div id="out"></div>
    <div class="statrow" id="stats"></div>
  </div>`;
  const q = $('#q');
  let info;
  let last = null;
  const waitReady = async () => {
    while (!ready) {
      $('#out').innerHTML = `<div class="loading"><div class="spinner"></div>Loading 264 tools, 30 skills and their links into HydraDB…</div>`;
      await new Promise(r => setTimeout(r, 1200));
    }
    $('#out').innerHTML = '';
  };
  await waitReady();
  info = await api('/api/info');
  drawStats(info);
  const picks = info.examples.slice(0, 10);
  $('#chips').innerHTML = picks.map((e, i) => `<button type="button" class="chip" data-i="${i}">${esc(e.text)}</button>`).join('');
  $('#chips').onclick = e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const ex = picks[+b.dataset.i];
    q.value = ex.text;
    run(ex.text, ex.tools);
  };
  $('#askForm').onsubmit = e => {
    e.preventDefault();
    const ex = picks.find(p => p.text === q.value.trim());
    run(q.value, ex?.tools);
  };

  async function run(text, key) {
    $('#go').disabled = true;
    try {
      const r = await api('/api/retrieve', { text });
      last = { text, key, r };
      show(r, key, text);
    } catch (err) {
      $('#out').innerHTML = `<div class="card" role="alert">${esc(err.message)}</div>`;
    } finally {
      $('#go').disabled = false;
    }
  }

  function counters(r) {
    const c = r.compare;
    $('#n2').textContent = r.tools.length;
    $('#preTok').textContent = `~${fmt(c.preloadTokens)} tokens per call`;
    $('#pullTok').textContent = `~${fmt(c.pulledTokens)} tokens`;
    $('#pullBar').style.width = `${Math.max(1.5, (c.pulledTokens / c.preloadTokens) * 100)}%`;
    $('#meta').textContent = `Found in ${r.ms} ms · ${r.requests} HydraDB requests · tokens are characters ÷ 4, a rough estimate`;
  }

  function show(r, key, text, banner = '') {
    counters(r);
    const need = new Set(key || []);
    const toolHtml = r.tools
      .map(t => {
        const state = key ? (need.has(t.id) ? 'ok' : '') : '';
        return `<div class="tool ${state}"><div><span class="name">${esc(t.id)}</span><span class="srv">${esc(t.server)}</span></div><div class="score" title="score ${t.score}"><i style="width:${Math.min(100, (t.score / (r.tools[0].score || 1)) * 100)}%"></i></div><div class="desc">${esc(t.description)}</div><div class="why">${t.why.map(w => `<span class="${cls(w.kind)}">${esc(WHY[w.kind]?.(w) || w.kind)}</span>`).join('')}</div></div>`;
      })
      .join('');
    const hit = key ? key.every(k => r.tools.some(t => t.id === k)) : null;
    const answer = key
      ? `<div class="answerkey">Tools this task really needs: <b>${key.map(esc).join(', ')}</b> · ${hit ? '<b style="color:var(--green)">all pulled ✓</b>' : '<b style="color:var(--red)">missed some</b>'}. Keyword search would have picked: ${r.compare.keywordSearchPicks.slice(0, 4).map(esc).join(', ') || 'nothing'}${key.every(k => r.compare.keywordSearchPicks.includes(k)) ? ' (also correct)' : ''}.</div>`
      : `<div class="answerkey">Keyword search on the same catalog would have picked: ${r.compare.keywordSearchPicks.slice(0, 4).map(esc).join(', ') || 'nothing'}.</div>`;
    $('#out').innerHTML = `${banner}<div class="grid2">
      <section class="card" aria-labelledby="tl"><h3 id="tl">Pulled for this task <span class="sub">${r.confident ? '' : 'The graph is unsure here, so a real agent would fall back to its default tools.'}</span></h3>${toolHtml || '<p class="muted">Nothing matched. Teach it below.</p>'}${answer}
        <div class="feedback" id="fb"><span class="muted">Was this right?</span><button class="btn good sm" id="yes">Yes, these are right</button><button class="btn ghost sm" id="no">Not quite, let me fix it</button></div>
        <div id="pickerBox"></div>
      </section>
      <section class="card" aria-labelledby="gl"><h3 id="gl">What the graph walked through <span class="sub">words → skills / systems → tools</span></h3>${graphSvg(r.trace)}<div class="legend"><span><i style="border-color:#4b4b57"></i>word</span><span><i style="border-color:var(--gold)"></i>skill</span><span><i style="border-color:var(--green)"></i>thing it knows</span><span><i style="border-color:var(--blue)"></i>system</span><span><i style="border-color:var(--orange)"></i>tool</span></div></section>
    </div>`;
    $('#yes').onclick = () => teach(r.tools.map(t => t.id));
    $('#no').onclick = () => openPicker(r);
  }

  let allTools = null;
  async function openPicker(r) {
    allTools = allTools || (await api('/api/tools'));
    const chosen = new Set();
    const box = $('#pickerBox');
    box.innerHTML = `<div class="picker"><label class="muted" for="ps">Tick the tools this task really needs</label><input id="ps" placeholder="Search 264 tools, e.g. calendar, invoice, logs"><div class="picklist" id="pl"></div><div><button class="btn sm" id="teach" disabled>Teach the graph</button></div></div>`;
    const draw = () => {
      const term = $('#ps').value.toLowerCase();
      const pool = [...new Set([...r.tools.map(t => t.id), ...allTools.map(t => t.id)])];
      const rows = pool.map(id => allTools.find(t => t.id === id)).filter(t => t && (!term || `${t.id} ${t.description}`.toLowerCase().includes(term))).slice(0, 40);
      $('#pl').innerHTML = rows.map(t => `<button type="button" class="pick ${chosen.has(t.id) ? 'on' : ''}" data-id="${esc(t.id)}"><span class="name">${esc(t.id)}</span><small>${esc(t.description)}</small></button>`).join('');
      $('#teach').disabled = !chosen.size;
    };
    box.onclick = e => {
      const p = e.target.closest('.pick');
      if (p) {
        chosen.has(p.dataset.id) ? chosen.delete(p.dataset.id) : chosen.add(p.dataset.id);
        draw();
      }
      if (e.target.id === 'teach') teach([...chosen]);
    };
    box.oninput = draw;
    draw();
    $('#ps').focus();
  }

  async function teach(used) {
    if (!last) return;
    try {
      const res = await api('/api/feedback', { text: last.text, used });
      info = await api('/api/info');
      drawStats(info);
      const b = new Set(res.before.tools.map(t => t.id));
      const a = new Set(res.after.tools.map(t => t.id));
      const banner = `<div class="learned" role="status"><h3>The graph learned from that</h3><div class="muted">${res.learned.created} new links, ${res.learned.reinforced} strengthened, ${res.learned.removed} dropped, ${res.learned.entityLinks} thing-to-system links. Stored as edge weights in HydraDB. This is the same wording you just typed; ask a differently worded version to see it generalize.</div>
        <div class="diff"><div><b>Before</b><ul>${res.before.tools.map(t => `<li class="${a.has(t.id) ? '' : 'gone'}">${esc(t.id)}</li>`).join('')}</ul></div><div><b>After</b><ul>${res.after.tools.map(t => `<li class="${b.has(t.id) ? '' : 'new'}">${esc(t.id)}</li>`).join('')}</ul></div></div></div>`;
      last = { ...last, r: res.after };
      show(res.after, used.length ? used : last.key, last.text, banner);
      pollStatus();
    } catch (err) {
      $('#pickerBox').innerHTML = `<div role="alert" class="muted">${esc(err.message)}</div>`;
    }
  }
}

function drawStats(info) {
  const e = info.edges;
  $('#stats').innerHTML = [
    [fmt(info.catalog.tools), 'tools in the catalog'],
    [fmt(Object.values(e).reduce((a, b) => a + b, 0)), 'edges in HydraDB'],
    [fmt(e.MENTIONS), 'word → tool links (learned weights)'],
    [fmt(info.learned), 'tasks learned this session'],
    [info.hydra.p50ms ? `${info.hydra.p50ms} ms` : '…', 'HydraDB request, median'],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');
}

function graphSvg(trace) {
  if (!trace?.length) return '<p class="muted">No edges to show yet.</p>';
  const nodes = new Map();
  const key = (n, k) => `${k}:${n}`;
  for (const e of trace) {
    for (const [n, k] of [[e.from, e.fromKind], [e.to, e.toKind]]) if (!nodes.has(key(n, k))) nodes.set(key(n, k), { name: n, kind: k, depth: 0 });
  }
  for (let pass = 0; pass < 6; pass++) for (const e of trace) {
    const a = nodes.get(key(e.from, e.fromKind));
    const b = nodes.get(key(e.to, e.toKind));
    b.depth = Math.max(b.depth, a.depth + 1);
  }
  const maxD = Math.max(...[...nodes.values()].map(n => n.depth));
  for (const n of nodes.values()) if (n.kind === 'tool') n.depth = maxD;
  const cols = [];
  for (const n of nodes.values()) (cols[n.depth] ||= []).push(n);
  const W = 560;
  const colW = (W - 150) / Math.max(1, maxD);
  const rowH = 34;
  const H = Math.max(...cols.map(c => (c ? c.length : 0))) * rowH + 20;
  cols.forEach((c, ci) => c?.forEach((n, ri) => { n.x = 10 + ci * colW; n.y = 12 + ri * rowH + (H - 20 - c.length * rowH) / 2; n.w = 140; }));
  const hot = new Set(trace.filter(e => e.toKind === 'tool').sort((a, b) => b.w - a.w).slice(0, 3).map(e => key(e.to, e.toKind)));
  const edges = trace.map(e => {
    const a = nodes.get(key(e.from, e.fromKind));
    const b = nodes.get(key(e.to, e.toKind));
    const x1 = a.x + a.w;
    const y1 = a.y + 12;
    const x2 = b.x;
    const y2 = b.y + 12;
    const mx = (x1 + x2) / 2;
    return `<path class="edge ${hot.has(key(e.to, e.toKind)) ? 'hot' : ''}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" stroke-width="${(0.8 + e.w * 2.4).toFixed(1)}" opacity="${(0.35 + e.w * 0.6).toFixed(2)}"><title>${esc(e.from)} → ${esc(e.to)} (${e.rel}, weight ${e.w})</title></path>`;
  }).join('');
  const boxes = [...nodes.values()].map(n => `<g class="node ${n.kind}" transform="translate(${n.x},${n.y})"><rect width="${n.w}" height="24"/><text x="8" y="16">${esc(n.name.length > 19 ? `${n.name.slice(0, 18)}…` : n.name)}</text></g>`).join('');
  return `<svg class="graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="Graph of the words, skills and systems that led to each tool">${edges}${boxes}</svg>`;
}

// ---------- Results ----------
async function results(root) {
  root.innerHTML = `<div class="wrap"><div class="eyebrow">Benchmark · measured on a running HydraDB node</div><h1>Does it work, and does it get better?</h1><p class="lede" id="rl">Loading results…</p><div id="rc"></div></div>`;
  let r;
  try {
    r = await api('/api/results');
  } catch {
    $('#rl').textContent = 'The benchmark has not been run on this server yet.';
    return;
  }
  const c = r.config;
  const lc = r.learningCurve;
  const bl = r.baselines;
  const last = lc.testCompleteMean.length - 1;
  $('#rl').innerHTML = `${c.tasks} tasks over a catalog of ${c.catalogTools} tools (${c.realMimirTools} are Mimir’s real tools). The graph is trained on one wording of each job and tested on a <b>different, unseen wording</b>. Five independent runs; shaded band is one standard deviation. “Complete” means every tool the task needs was pulled.`;
  const orange = '#ff5b1f';
  const body = [];
  body.push(`<section class="card"><h2>It learns: held-out accuracy rises with experience</h2>${lineChart({
    xs: lc.epochs, title: 'Held-out accuracy by training pass',
    series: [
      { name: 'Graph, test set', color: orange, values: lc.testCompleteMean, band: lc.testCompleteSd },
      { name: 'Graph, training set', color: '#6a6a74', values: lc.trainCompleteMean, dashed: true, label: false },
    ],
    refs: [{ value: bl.bm25Tools.complete, color: '#ff6464', label: 'Keyword search' }, { value: bl.bm25ToolsAndSkills.complete, color: '#ffc247', label: 'Keyword search + skills' }],
    xLabel: 'Training passes over the same 160 examples (pass 0 = before any learning)',
  })}<p class="note">Orange: tasks the graph never saw, in new wording. Gray dashed: the tasks it trained on (it memorizes those). The gap is honest: held-out wording is the hard part, and where the graph still misses is shown in the table below.</p></section>`);
  if (r.jargon) {
    const j = r.jargon;
    body.unshift(`<section class="card"><h2>It learns your team’s own words</h2>${lineChart({
      xs: ['Never seen', 'After 1 example', 'After 2 examples'], title: 'Held-out jargon tasks found', width: 760, height: 300,
      series: [{ name: 'Graph', color: orange, values: [j.heldOut.cold, j.heldOut.afterOneExample, j.heldOut.afterTwoExamples] }],
      refs: [{ value: j.bm25HeldOut, color: '#ff6464', label: 'Keyword search (cannot learn)' }],
      xLabel: `${j.tasks} private words (${j.terms.slice(0, 5).join(', ')}…), each tested on a wording it was never taught`,
    })}<p class="note">Private jargon cannot be in any tool description, so the graph starts at ${j.heldOut.cold}%. After one example it finds the right tools ${j.heldOut.afterOneExample}% of the time, after two ${j.heldOut.afterTwoExamples}%. Forgetting check: the ${r.config.test} general held-out tasks scored ${j.regressionBefore}% before learning the jargon and ${j.regressionAfter}% after, so nothing was damaged.</p></section>`);
  }
  const kinds = { D: 'Plain jobs (1–2 tools)', S: 'Multi-step jobs (known skills)', E: 'Jobs about a thing it learned (Acme, Kestrel…)' };
  body.push(`<section class="card"><h2>Where the graph earns its place</h2>${lineChart({ xs: lc.epochs, title: 'Held-out accuracy by job type', width: 760, height: 320, series: [
    { name: 'Plain', color: '#9b9ba6', values: lc.byKindMean.D }, { name: 'Skills', color: '#ffc247', values: lc.byKindMean.S }, { name: 'Entities', color: '#43e08a', values: lc.byKindMean.E },
  ], xLabel: 'Training passes' })}<div class="legend"><span><i style="border-color:#9b9ba6"></i>${kinds.D}</span><span><i style="border-color:#ffc247"></i>${kinds.S}</span><span><i style="border-color:#43e08a"></i>${kinds.E}</span></div><p class="note">Entities are the clearest win for a graph: the same words (“tickets”, “logs”) belong to different systems depending on who is asked about, and that is a link, not a keyword.</p></section>`);
  body.push(`<section class="card"><h2>Versus the alternatives (held-out tasks)</h2>${barChart({ title: 'Share of tasks where every needed tool was pulled', rows: [
    { label: 'Preload all 264 tools', value: 100, color: '#6a6a74', text: `100% · ${c.catalogTools} tools` },
    { label: 'Graph after learning', value: lc.testCompleteMean[last], color: orange, text: `${lc.testCompleteMean[last]}% · ${lc.avgToolsLoaded[last]} tools` },
    { label: 'Graph, cold start', value: lc.testCompleteMean[0], color: '#c2481a', text: `${lc.testCompleteMean[0]}% · ${lc.avgToolsLoaded[0]} tools` },
    { label: 'Keyword search + skills', value: bl.bm25ToolsAndSkills.complete, color: '#ffc247', text: `${bl.bm25ToolsAndSkills.complete}% · ${bl.bm25ToolsAndSkills.avgTools} tools` },
    { label: 'Keyword search', value: bl.bm25Tools.complete, color: '#ff6464', text: `${bl.bm25Tools.complete}% · ${bl.bm25Tools.avgTools} tools` },
  ] })}<p class="note">Preloading is always “complete” because it hands over everything, at ${Math.round(c.allToolsSchemaChars / 4).toLocaleString()} estimated tokens per call. The graph hands over about ${lc.avgToolsLoaded[last]} tools (roughly 1,500 characters). A small model with that many tools in front of it also picks the wrong one more often, as the local-model test below shows.</p></section>`);
  if (r.llm) {
    const rows = Object.entries(r.llm.methods).map(([k, v]) => ({ label: k, value: v.firstCallHitPct, color: k.startsWith('All') ? '#6a6a74' : k.includes('learning') ? orange : '#4a4a55', text: `${v.firstCallHitPct}% · ${v.avgToolsOffered} tools · ${v.avgMs} ms` }));
    body.push(`<section class="card"><h2>End to end with a real local model</h2>${barChart({ rows, title: 'Chance the model calls a needed tool first' })}<p class="note">${esc(r.llm.model)} running locally through Ollama, ${r.llm.sampleSize} unseen tasks, temperature 0. Each row gives the model a different list of tools. “Hit” means its first tool call was one the task needs. The last number on each row is the average prompt tokens and time per call.</p>
      <table><thead><tr><th>Tools offered by</th><th class="num">Right first call</th><th class="num">Needed tool offered</th><th class="num">Tools</th><th class="num">Prompt tokens</th><th class="num">Time per call</th></tr></thead><tbody>${Object.entries(r.llm.methods).map(([k, v]) => `<tr class="${k.includes('learning') ? 'win' : ''}"><td>${esc(k)}</td><td class="num">${v.firstCallHitPct}%</td><td class="num">${v.toolOfferedPct}%</td><td class="num">${v.avgToolsOffered}</td><td class="num">${fmt(v.avgPromptTokens)}</td><td class="num">${fmt(v.avgMs)} ms</td></tr>`).join('')}</tbody></table></section>`);
  }
  body.push(`<section class="card"><h2>When it isn’t sure</h2><table><thead><tr><th>Confidence needed</th><th class="num">Tasks it answers</th><th class="num">Right when it answers</th></tr></thead><tbody>${r.confidence.sweep.map(s => `<tr><td>top score ≥ ${s.threshold}</td><td class="num">${s.coveragePct}%</td><td class="num">${s.completeWhenConfident ?? '-'}%</td></tr>`).join('')}</tbody></table><p class="note">The graph knows when it is unsure. In the agent, an unsure answer falls back to the default tool set instead of guessing: ${r.confidence.withFallback.complete}% complete with that fallback, still far below preloading (${r.confidence.withFallback.avgSchemaChars.toLocaleString()} characters per call on average).</p></section>`);
  body.push(`<section class="card"><h2>A tool the graph has never seen</h2><table><thead><tr><th>Held-out wording, tool added at run time</th><th class="num">Found</th></tr></thead><tbody><tr><td>Only its description</td><td class="num">${r.drift.heldOutCompletePct.onlyDescription}%</td></tr><tr><td>After 1 example</td><td class="num">${r.drift.heldOutCompletePct.afterOneExample}%</td></tr><tr><td>After 2 examples</td><td class="num">${r.drift.heldOutCompletePct.afterTwoExamples}%</td></tr></tbody></table><p class="note">${r.drift.newTools} new tools were added with no rebuild. ${esc(r.drift.note)}.</p></section>`);
  body.push(`<section class="card"><h2>Does it hold up under load and size?</h2><table><thead><tr><th>Catalog</th><th class="num">Graph accuracy (cold)</th><th class="num">Keyword search</th><th class="num">Requests / pull</th><th class="num">1 client</th><th class="num">8 clients</th><th class="num">32 clients</th></tr></thead><tbody>${r.scale.map(s => `<tr><td>${fmt(s.catalogTools)} tools</td><td class="num">${s.graphCompleteCold}%</td><td class="num">${s.bm25Complete}%</td><td class="num">${s.graphAvgRequests}</td>${s.load.map(l => `<td class="num">${l.perSec}/s · p95 ${l.p95ms} ms</td>`).join('')}</tr>`).join('')}</tbody></table><p class="note">Pulls per second and 95th-percentile latency of a full retrieval (several HydraDB hops) on one small laptop VM (4 cores, 3 GB), with HydraDB and the load generator on the same machine. Extra tools beyond the first 264 are synthetic distractors made from the same vocabulary. The prompt stays small as the catalog grows; preloading would grow with it.</p></section>`);
  $('#rc').innerHTML = body.join('<div style="height:18px"></div>');
}

// ---------- How it works ----------
function how(root) {
  root.innerHTML = `<div class="wrap"><div class="eyebrow">How it works</div><h1>A graph the agent walks, instead of a manual it reads.</h1>
  <p class="lede">Everything lives in HydraDB. Retrieval is a few bounded traversals; learning is a few edge-weight updates.</p>
  <div class="grid2"><section class="card"><h2>The graph</h2><table><thead><tr><th>Edge</th><th>Meaning</th></tr></thead><tbody>
    <tr><td class="mono">Term → Tool | Skill</td><td>What a word points at. Weight is learned.</td></tr>
    <tr><td class="mono">Term → Term (similar)</td><td>A bridge from unfamiliar wording to a known word, built from word embeddings.</td></tr>
    <tr><td class="mono">Skill → Tool (requires)</td><td>The tools a known procedure needs, even if the request never names them.</td></tr>
    <tr><td class="mono">Entity → System</td><td>Where a thing the agent already resolved lives (Acme → payments, CRM).</td></tr>
    <tr><td class="mono">System → Tool</td><td>Which app a tool belongs to.</td></tr>
    <tr><td class="mono">Tool → Tool (used with)</td><td>Tools that were used together before.</td></tr></tbody></table></section>
  <section class="card"><h2>One pull, step by step</h2><ol style="padding-left:20px;margin:0;display:grid;gap:8px;color:#d6d6dc">
    <li>Split the request into words. <span class="muted">0 requests</span></li>
    <li>Words → similar words (one HydraDB request, many words joined with UNION ALL).</li>
    <li>Words → tools and skills (one request).</li>
    <li>Skills → the tools they require (one request).</li>
    <li>Things the agent knows → systems → their tools, as a boost (two requests).</li>
    <li>Tools used together before (one request).</li>
    <li>Return the best few. If nothing scored, say so and fall back.</li></ol>
    <p class="note" style="margin-top:12px">Learning, after a task: strengthen the edges to tools that were really used, add edges for words that pointed nowhere, weaken edges to tools that were pulled and ignored, link the entity to the system it turned out to live in, link tools used together.</p></section></div>
  <section class="card" style="margin-top:18px"><h2>Honest limits</h2><ul style="margin:0;padding-left:20px;display:grid;gap:6px;color:#cfcfd6">
    <li>The 245 tools that aren’t Mimir’s own are modelled on the public MCP servers of the same names; nothing here executes them.</li>
    <li>Task labels and skills were written by one person, so the benchmark is a controlled test, not a field study. The next step is replaying real agent logs.</li>
    <li>Held-out accuracy is well below 100%. The graph helps most when wording varies, a thing is known, or the catalog is large; it does not understand language, it follows learned links.</li>
    <li>Similar-word links come from a small embedding model and are noisy for single words.</li>
    <li>HydraDB’s query dialect is narrow (no expressions in RETURN, one relationship type per pattern). This design works inside it.</li></ul></section></div>`;
}

pollStatus();
route();
