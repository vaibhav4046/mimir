import { lineChart, barChart } from './charts.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = n => Number(n).toLocaleString('en-US');

const CSS = `
.deckhost{position:fixed;inset:0;z-index:50;background:#050506;overflow:hidden}
.stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center;background:var(--bg);overflow:hidden}
.scene{position:absolute;inset:0;padding:84px 112px;opacity:0;pointer-events:none;transition:opacity .45s ease;display:flex;flex-direction:column}
.scene.on{opacity:1;pointer-events:auto}
.scene .tag{font:700 22px var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--orange);margin-bottom:26px}
.scene h1{font-size:104px;line-height:1;letter-spacing:-.045em;margin:0 0 24px;max-width:1500px}
.scene h2{font-size:68px;letter-spacing:-.035em;line-height:1.04;margin:0 0 22px}
.scene p.big{font-size:36px;line-height:1.35;color:#cfcfd6;max-width:1400px;margin:0 0 18px}
.scene .row{display:flex;gap:30px;align-items:stretch}
[data-r]{opacity:0;transform:translateY(22px);transition:opacity .55s ease,transform .55s cubic-bezier(.2,.8,.2,1)}
[data-r].in{opacity:1;transform:none}
.mark{position:absolute;right:112px;top:70px;display:flex;align-items:center;gap:14px;font:600 22px var(--mono);color:var(--muted)}
.mark img{width:44px;height:44px;border-radius:10px}
.num{font:700 150px var(--font);letter-spacing:-.05em;line-height:.95}
.card2{background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:30px 34px;flex:1}
.card2 h3{font-size:34px;margin:0 0 10px}
.card2 p{font-size:25px;color:#b9b9c2;margin:0;line-height:1.4}
.src{font:500 19px var(--mono);color:var(--muted);margin-top:12px}
.ev{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;margin-top:8px}
.ev figure{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;display:flex;flex-direction:column}
.ev img{width:100%;height:280px;object-fit:cover;object-position:top left;display:block;background:#101012}
.ev figcaption{padding:16px 20px;font-size:22px;line-height:1.35}
.ev figcaption b{display:block;font:700 40px var(--font);letter-spacing:-.03em;color:var(--orange)}
.ev figcaption small{display:block;color:var(--muted);font:500 16px var(--mono);margin-top:8px}
.win{background:var(--orange-soft)!important;border-color:var(--orange)!important}
.bigtable{width:100%;font-size:34px;border-collapse:collapse}
.bigtable th,.bigtable td{padding:20px 24px;border-bottom:1px solid var(--line)}
.bigtable th{font-size:20px;color:var(--muted)}
.bigtable td.num{font-family:var(--mono);text-align:right;font-size:inherit;font-weight:700;letter-spacing:0;line-height:1.2}
.bigtable.compact{font-size:38px}.bigtable.compact th,.bigtable.compact td{padding:16px 22px;white-space:nowrap}.bigtable.compact th{font-size:20px}.bigtable .neutral{color:#c9c9d2}.bigtable .honest{font-size:18px;color:#ffb347;font-style:normal;margin-left:10px}
.bigtable .after{color:var(--orange);font-weight:700}
.bigtable .before{color:#8a8a95;text-decoration:line-through;text-decoration-color:rgba(255,100,100,.55)}
.pbar{height:34px;border-radius:10px;background:var(--panel2);overflow:hidden}
.pbar i{display:block;height:100%;width:0;transition:width 1.4s cubic-bezier(.2,.8,.2,1)}
.in .pbar i, .pbar.in i{width:var(--w)}
.stackwin{position:relative;height:84px;border:2px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
.stackwin i{position:absolute;inset:0 auto 0 0;width:0;background:repeating-linear-gradient(90deg,#ff5b1f 0 10px,#c2481a 10px 12px);transition:width 3.2s cubic-bezier(.25,.7,.2,1)}
.stackwin.go i{width:var(--fill)}
.stackwin span{position:absolute;right:22px;top:50%;transform:translateY(-50%);font:700 26px var(--mono)}
.arch{width:100%;height:auto}
.arch text{font:500 22px var(--mono);fill:#e8e8ec}
.arch .t{font:700 28px var(--font)}
.arch rect.box{fill:#131316;stroke:#3a3a44;stroke-width:2;rx:18}
.arch rect.hot{stroke:#ff5b1f;fill:rgba(255,91,31,.1)}
.arch path{fill:none;stroke:#6a6a76;stroke-width:3}
.arch path.hot{stroke:#ff5b1f}
.progress{position:absolute;left:0;bottom:0;height:5px;background:var(--orange);transition:width .4s}
.persona{display:flex;flex-direction:column;gap:14px}
.persona .av{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;font:700 38px var(--font);color:#000}
.persona h3{font-size:40px;margin:0}
.persona p{margin:0;font-size:25px}
.persona .pain{color:#ff9a73}.persona .gain{color:var(--green)}
.well{position:relative;width:520px;height:520px;margin:0 auto}
.well .ring{position:absolute;inset:0;border-radius:50%;border:3px solid rgba(255,91,31,.55);animation:ripple 4.5s ease-out infinite}
.well .ring:nth-child(2){animation-delay:1.5s}.well .ring:nth-child(3){animation-delay:3s}
@keyframes ripple{0%{transform:scale(.35);opacity:.9}100%{transform:scale(1.15);opacity:0}}
.well img{position:absolute;left:50%;top:50%;width:300px;height:300px;transform:translate(-50%,-50%);image-rendering:pixelated;animation:bob 5s ease-in-out infinite;filter:drop-shadow(0 0 40px rgba(255,91,31,.45))}
@keyframes bob{50%{transform:translate(-50%,-56%)}}
.runes{font:600 26px var(--mono);letter-spacing:.5em;color:rgba(255,91,31,.55);text-align:center;margin-top:10px}
.cold{align-items:center;justify-content:center;text-align:center}
.cold h1{font-size:92px;max-width:1500px;margin:12px auto 0}
.cold p{font-size:34px;color:#cfcfd6;margin:14px auto 0}
`;

export async function renderDeck(root) {
  let R;
  try {
    R = await (await fetch('/api/results')).json();
  } catch {
    R = null;
  }
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const lc = R?.learningCurve;
  const last = lc ? lc.testCompleteMean.length - 1 : 0;
  const bl = R?.baselines;
  const llm = R?.llm?.methods;
  const llmAll = llm?.['All tools preloaded'];
  const llmLearned = llm?.['Graph, after learning'];
  const orange = '#ff5b1f';
  const tokensPre = llmAll ? llmAll.avgPromptTokens : R ? Math.round(R.config.allToolsSchemaChars / 4) : 15500;

  const scenes = [
    `<div class="cold" style="display:flex;flex-direction:column;flex:1"><div class="well"><i class="ring"></i><i class="ring"></i><i class="ring"></i><img src="/img/mimir-head.svg" alt="Mimir, the keeper of the well"></div><div class="runes" data-r="0">ᛗ ᛁ ᛗ ᛁ ᚱ</div><h1 data-r="1">Carry less. Know where to look.</h1><p data-r="2">A context layer for agents, built on HydraDB.</p></div>`,
    // 1 problem
    `<div class="tag" data-r="0">The problem</div>
     <h1 data-r="0">Your AI agent reads <span style="color:var(--orange)">55,000 tokens</span> of manuals before it reads your request.</h1>
     <p class="big" data-r="1">Every call. Every time. Five connected apps already cost that much, before you type a word.</p>
     <div data-r="1" style="margin-top:34px"><div class="stackwin" id="stk"><i style="--fill:27.5%"></i><span>55,000 of 200,000 tokens, gone</span></div></div>
     <p class="big" data-r="2" style="margin-top:46px;font-size:46px;color:#fff">How many tools is <i>your</i> agent carrying right now?</p>`,
    // 2 evidence
    `<div class="tag" data-r="0">The evidence</div>
     <h2 data-r="0">It is measured, repeated, and getting worse as agents connect to more apps.</h2>
     <div class="ev">
       <figure data-r="1"><img src="/evidence/anthropic.png" alt="Anthropic engineering article on advanced tool use" onerror="this.style.display='none'"><figcaption><b>77K → 8.7K</b>tokens of tool definitions before work begins, loaded up front vs on demand (85% less). Five apps alone: 55K. “At Anthropic, we’ve seen tool definitions consume 134K tokens.”<small>Anthropic Engineering · Advanced tool use</small></figcaption></figure>
       <figure data-r="2"><img src="/evidence/rag-mcp.png" alt="RAG-MCP paper abstract on arXiv" onerror="this.style.display='none'"><figcaption><b>13.6% → 43.1%</b>tool-selection accuracy without and with retrieval; prompt tokens cut by over half.<small>RAG-MCP, arXiv 2505.03275 · Gan &amp; Sun</small></figcaption></figure>
       <figure data-r="3"><img src="/evidence/willison.png" alt="Simon Willison on the token cost of MCP servers" onerror="this.style.display='none'"><figcaption><b>93 tools · ~55K tokens</b>for one popular server. “LLMs tend to perform worse when irrelevant information fills their prompts.”<small>Simon Willison, 22 Aug 2025</small></figcaption></figure>
     </div>
     <div class="row" style="margin-top:26px" data-r="4"><div class="card2"><h3>And the fix has been shipped as a feature</h3><p>Anthropic reports Opus 4 going from 49% to 74% on its MCP evaluations once tools load on demand. The need is real. The question is how an agent should find tools: by keyword, or by understanding how things connect.</p></div></div>`,
    // 3 cost
    `<div class="tag" data-r="0">What it costs</div>
     <h2 data-r="0">The same manual is billed again on every single call.</h2>
     <div class="row" style="margin-top:12px">
       <div class="card2" data-r="1"><div class="num" style="color:var(--orange)">1.65B</div><p>tokens a month from just the tool list: 55,000 tokens × 1,000 calls a day × 30 days.</p></div>
       <div class="card2" data-r="2"><div class="num">$4,950</div><p>a month for that one team at an example <b>$3 per million</b> input tokens. About $495 if the prompt cache serves it at a tenth of the price. Your rate will differ.</p></div>
       <div class="card2" data-r="3"><div class="num" style="color:var(--red)">${(tokensPre / 8192).toFixed(1)}×</div><p>On a laptop it is worse: our 264-tool catalog came to ${fmt(tokensPre)} tokens as the model counted them, bigger than the 8,192-token window Mimir gives a local model by default.</p></div>
     </div>
     <p class="big" data-r="4" style="margin-top:34px">And it is not only money. More tools in front of a model means more wrong picks, slower answers, and less room for the actual job.</p>
     <p class="src" data-r="4">Token counts: Anthropic Engineering. Prices are an example rate, not a quote; cached-read discount is an assumption.</p>`,
    // 4 who
    `<div class="tag" data-r="0">Who it is for</div>
     <h2 data-r="0">People running agents on local or small models with dozens of tools (illustrative profiles, not customers; Mimir is the first real user).</h2>
     <div class="row" style="margin-top:14px">
       <div class="card2 persona" data-r="1"><div class="av" style="background:#ffc247">M</div><h3>Mira, builds a local-first agent app</h3><p>Small models by default, a hundred-plus tools across servers, no tool search on those models.</p><p class="pain">Pain: the tool list eats the context window before the request arrives.</p><p class="gain">With the graph: a handful of tools per task, and it remembers which app a client lives in.</p></div>
       <div class="card2 persona" data-r="2"><div class="av" style="background:#5ac8ff">D</div><h3>Dev, leads a small agency</h3><p>Builds agents for five clients with 60+ tools across servers.</p><p class="pain">Pain: token bills and “too many tools” errors.</p><p class="gain">With the graph: each task pulls five tools, not sixty.</p></div>
       <div class="card2 persona" data-r="3"><div class="av" style="background:#43e08a">L</div><h3>Lee, runs a small model at home</h3><p>1.7B model on a laptop. Private, free, and an 8K window.</p><p class="pain">Pain: the tool list doesn’t even fit.</p><p class="gain">With the graph: it fits, and it is faster.</p></div>
     </div>`,
    // 5 solution
    `<div class="tag" data-r="0">The solution</div>
     <h1 data-r="0" style="font-size:96px">Keep tools in a graph. <span style="color:var(--orange)">Walk it.</span> Pull only what the task needs.</h1>
     <div class="row" style="margin-top:30px">
       <div class="card2" data-r="1"><h3 style="color:var(--orange)">1 · Walk</h3><p>The task’s words lead through skills, things the agent already knows, and the apps they live in, to the few tools that matter. All of it is HydraDB traversal.</p></div>
       <div class="card2" data-r="2"><h3 style="color:var(--orange)">2 · Pull</h3><p>About five tool definitions go to the model instead of two hundred and sixty-four. If the graph is unsure, it says so and the agent falls back.</p></div>
       <div class="card2" data-r="3"><h3 style="color:var(--orange)">3 · Learn</h3><p>Tell it what worked. Edge weights change, new links appear, entities attach to their apps. The next task can use what it learned.</p></div>
     </div>
     <p class="big" data-r="4" style="margin-top:34px">One sentence: <b style="color:#fff">an agent that remembers where its tools and its world connect, and gets better every time.</b></p>`,
    // 6 demo card
    `<div class="tag">Live demo</div><h1>Let me show you.</h1><p class="big">A real HydraDB node, a real catalog of 264 tools, and a real local model.</p>`,
    // 7 before after
    `<div class="tag" data-r="0">Before and after</div>
     <h2 data-r="0">Same tasks. Same small local model. Far less to read.</h2>
     ${R ? `<table class="bigtable compact" data-r="1"><thead><tr><th></th><th class="num">Preload everything</th><th class="num">Context Graph</th></tr></thead><tbody>
       <tr><td>Tools in the prompt</td><td class="num before">${R.config.catalogTools}</td><td class="num after">${lc.avgToolsLoaded[last]}</td></tr>
       <tr><td>Prompt tokens per call</td><td class="num before">${llmAll ? fmt(llmAll.avgPromptTokens) : '…'}</td><td class="num after">${llmLearned ? fmt(llmLearned.avgPromptTokens) : '…'}</td></tr>
       <tr><td>Time per call</td><td class="num before">${llmAll ? fmt(llmAll.avgMs) : '…'} ms</td><td class="num after">${llmLearned ? fmt(llmLearned.avgMs) : '…'} ms</td></tr>
       <tr><td>Right first tool call (${esc(R.llm?.model || 'model')}, ${R.llm?.sampleSize || 40} tasks) <i class="honest">not an improvement</i></td><td class="num neutral">${llmAll ? llmAll.firstCallHitPct : '…'}%</td><td class="num neutral">${llmLearned ? llmLearned.firstCallHitPct : '…'}%</td></tr>
     </tbody></table>
     <div class="row" style="margin-top:26px" data-r="2"><div class="card2" style="padding:16px 22px">${R.jargon ? lineChart({ width: 1100, height: 300, xs: ['Never seen', '1 example', '2 examples'], title: 'jargon learning', series: [{ name: 'graph', color: orange, values: [R.jargon.heldOut.cold, R.jargon.heldOut.afterOneExample, R.jargon.heldOut.afterTwoExamples] }], refs: [{ value: R.jargon.bm25HeldOut, color: '#ff6464', label: 'Keyword search' }], xLabel: 'Your team\u2019s own words, tested on new wording' }) : ''}</div>
       <div class="card2" style="display:flex;flex-direction:column;justify-content:center"><p style="font-size:30px;color:#fff">${R.jargon ? `Private jargon: <b style="color:var(--orange)">${R.jargon.heldOut.cold}% \u2192 ${R.jargon.heldOut.afterOneExample}% \u2192 ${R.jargon.heldOut.afterTwoExamples}%</b> after one and two examples. Nothing forgotten (${R.jargon.regressionBefore}% \u2192 ${R.jargon.regressionAfter}% on everything else).` : ''}</p></div></div>` : '<p class="big">Benchmark results not loaded.</p>'}`,
    // 8 architecture
    `<div class="tag" data-r="0">How it is built</div>
     <h2 data-r="0">A thin service. All the memory is in HydraDB.</h2>
     <svg class="arch" viewBox="0 0 1700 560" data-r="1" role="img" aria-label="Architecture: agent, context graph service, HydraDB">
       <rect class="box" x="10" y="150" width="330" height="250"/><text class="t" x="40" y="205">Agent</text><text x="40" y="250">Mimir · any MCP host</text><text x="40" y="290">task text in</text><text x="40" y="330">5 tool schemas out</text>
       <rect class="box hot" x="520" y="90" width="500" height="370"/><text class="t" x="552" y="145">Context Graph service</text>
       <text x="552" y="195">retrieve(task) → tools</text><text x="552" y="235">learn(task, used) → weights</text><text x="552" y="275">addTool(def) → no rebuild</text><text x="552" y="330">confidence → fall back if low</text><text x="552" y="385">small · zero dependencies</text>
       <rect class="box hot" x="1200" y="40" width="490" height="480"/><text class="t" x="1232" y="95">HydraDB (graph-node)</text>
       <text x="1232" y="145">Term · Tool · Skill</text><text x="1232" y="185">Server · Entity</text>
       <text x="1232" y="240">MENTIONS{w}  SIMILAR{w}</text><text x="1232" y="280">REQUIRES  SERVES</text><text x="1232" y="320">RESOLVES_TO{w}  NEXT{w}</text>
       <text x="1232" y="385">one UNION ALL request per hop</text><text x="1232" y="425">OpenCypher over HTTP / Bolt</text><text x="1232" y="480">object-store durable</text>
       <path d="M340 240 L520 240" /><path class="hot" d="M340 310 L520 310"/><path class="hot" d="M1020 220 L1200 220"/><path class="hot" d="M1020 330 L1200 330"/>
       <text x="352" y="228" style="font-size:19px">task</text><text x="340" y="345" style="font-size:19px;fill:#ff5b1f">tools</text><text x="1050" y="208" style="font-size:19px">read</text><text x="1040" y="362" style="font-size:19px;fill:#ff5b1f">write weights</text>
     </svg>
     <p class="big" data-r="2" style="margin-top:6px;font-size:30px">Learning is a few edge-weight updates. Retrieval is a few bounded hops. Neither calls a model.</p>`,
    // 9 why graph
    `<div class="tag" data-r="0">Why a graph, why HydraDB</div>
     <h2 data-r="0">Would this fall apart on a plain store? Parts of it would.</h2>
     <div class="row" style="margin-top:14px">
       <div class="card2" data-r="1"><h3>Hops through skills and systems</h3><p>“Morning briefing” never says calendar. A skill links it to news, mail and calendar tools, and “tickets for Northwind” resolves to Northwind’s app. Each pull shows the path it took.</p></div>
       <div class="card2" data-r="2"><h3>Weights that are the memory</h3><p>Every “that worked” is an edge update in HydraDB. ${R ? `${fmt(lc.edgeWritesPerTrial)} edge writes` : 'Thousands of edge writes'} per run of 160 examples, no retraining, no model.</p></div>
       <div class="card2" data-r="3"><h3>Speed, honestly</h3><p>${R ? R.scale.map(s => `${fmt(s.catalogTools)} tools: ${Math.round(s.load[0].p50ms)} ms per lookup`).join('<br>') + '<br>It slows as the catalog grows. The prompt does not.' : ''}</p></div>
     </div>
     <p class="big" data-r="4" style="margin-top:30px">Honest part: a keyword index that also learns from past tasks reaches ${R?.flatLearner ? Math.max(...R.flatLearner.rows.slice(1).map(x => x.complete)) : '…'}% on the same tasks, about what the graph gets. What the graph adds is a visible path for every pull and state kept in HydraDB, not a higher score.</p>`,
    // 10 me + gtm
    `<div class="tag" data-r="0">Why me · who pays</div>
     <h2 data-r="0">I already ship the agent this plugs into.</h2>
     <div class="row" style="margin-top:14px">
       <div class="card2" data-r="1"><h3>Vaibhav</h3><p>Solo builder of <b>Mimir</b>, a local-first AI agent workspace for Windows: 24/7 scheduler, workflows, a model library for any machine. 103 automated tests, a public installer, a live site.</p><p style="margin-top:12px">For this hackathon I built HydraDB from source in WSL, found its dialect traps the hard way, and wired the result into Mimir’s agent loop.</p></div>
       <div class="card2" data-r="2"><h3>Who pays</h3><p><b>Agent builders</b> hitting tool-count limits. <b>Local-first apps</b> with small windows. <b>Teams</b> who want one shared, learning context layer for every agent they run.</p><p style="margin-top:12px">Free open-source core. Paid: a hosted graph with team-shared learning, audit of what each agent pulled and why, and per-client isolation. A proposal to validate, not a pricing page.</p></div>
       <div class="card2 win" data-r="3"><h3>Try it now</h3><p>Live demo, source and benchmark:</p><p style="font:600 28px var(--mono);color:#fff;margin-top:12px">github.com/vaibhav4046/mimir<br>/contextgraph</p><p style="margin-top:16px">Built on <b>@hydra_db</b>.</p></div>
     </div>`,`<div class="cold" style="display:flex;flex:1;flex-direction:column"><div class="well" style="transform:scale(.8)"><i class="ring"></i><i class="ring"></i><i class="ring"></i><img src="/img/mimir-head.svg" alt="Mimir"></div><h1 data-r="1">Follow the graph.</h1><p data-r="2">Live demo, code and benchmark: github.com/vaibhav4046/mimir/contextgraph · built on @hydra_db</p></div>`
  ];

  document.body.classList.add('deck');
  root.innerHTML = '';
  const style = document.createElement('style');
  style.textContent = CSS;
  const host = document.createElement('div');
  host.className = 'deckhost';
  host.innerHTML = `<div class="stage" id="stage">${scenes.map((s, i) => `<section class="scene" data-i="${i}" aria-label="Scene ${i + 1}"><div class="mark"><img src="/img/hydradb-avatar.png" alt="">built on HydraDB</div>${s}</section>`).join('')}<div class="progress" id="prog"></div></div>`;
  root.append(style, host);
  const stage = $('#stage', host);
  const fit = () => stage.style.setProperty('transform', `translate(-50%,-50%) scale(${Math.min(innerWidth / 1920, innerHeight / 1080)})`);
  fit();
  addEventListener('resize', fit);
  let cur = -1;
  let level = 0;
  const maxLevel = i => Math.max(0, ...[...host.querySelectorAll(`.scene[data-i="${i}"] [data-r]`)].map(e => +e.dataset.r));
  const apply = () => {
    host.querySelectorAll('.scene').forEach(s => s.classList.toggle('on', +s.dataset.i === cur));
    host.querySelectorAll(`.scene[data-i="${cur}"] [data-r]`).forEach(e => e.classList.toggle('in', +e.dataset.r <= level));
    $('#prog', host).style.width = `${((cur + 1) / scenes.length) * 100}%`;
    const stk = host.querySelector(`.scene[data-i="${cur}"] .stackwin`);
    if (stk) setTimeout(() => stk.classList.add('go'), 500);
  };
  const api = {
    count: scenes.length,
    goto(i, lv = 0) { cur = Math.max(0, Math.min(scenes.length - 1, i)); level = lv; apply(); },
    reveal(lv) { level = lv; apply(); },
    next() { if (level < maxLevel(cur)) { level += 1; apply(); } else if (cur < scenes.length - 1) api.goto(cur + 1); },
    prev() { if (level > 0) { level -= 1; apply(); } else if (cur > 0) api.goto(cur - 1, maxLevel(cur - 1)); },
    maxLevel,
  };
  window.deckApi = api;
  window.onkeydown = e => {
    if (!document.body.classList.contains('deck')) return;
    if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); api.next(); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); api.prev(); }
    if (e.key === 'Escape') location.hash = '#/';
  };
  host.addEventListener('click', () => api.next());
  api.goto(Number(params.get('scene') || 1) - 1, Number(params.get('level') || 0));
  addEventListener('hashchange', () => { if (!location.hash.startsWith('#/deck')) { document.body.classList.remove('deck'); host.remove(); window.onkeydown = null; } }, { once: true });
}

function $(s, el = document) {
  return el.querySelector(s);
}
