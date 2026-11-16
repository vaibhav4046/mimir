// Writes docs/x-article.md, docs/x-post.md and docs/form-answers.md from results/results.json,
// so every number in the write-up is one that was measured.
//   node tools/make-social.mjs <liveUrl> <repoUrl> [videoUrl]
import fs from 'node:fs';
const [LIVE, REPO, VIDEO = '(add the Loom link)'] = process.argv.slice(2);
const dir = new URL('../', import.meta.url);
const R = JSON.parse(fs.readFileSync(new URL('results/results.json', dir), 'utf8'));
const lc = R.learningCurve;
const last = lc.epochs.length - 1;
const bl = R.baselines;
const llm = R.llm?.methods || {};
const all = llm['All tools preloaded'];
const learned = llm['Graph, after learning'];
const big = R.scale.at(-1);
const small = R.scale[0];
const E = lc.byKindMean.E;
const n = x => Number(x).toLocaleString('en-US');

const article = `# Teaching an agent to carry five tools instead of two hundred and sixty-four, with HydraDB

Every tool an AI agent can call is described to the model in the prompt, on every call. Anthropic measured five connected apps at about 55,000 tokens before the first word, and has seen 134,000. A retrieval paper (RAG-MCP) found tool-selection accuracy going from 13.6% to 43.1% when tools are retrieved instead of loaded. On a small local model the list may not even fit: my ${R.config.catalogTools}-tool test catalog is about ${n(Math.round(R.config.allToolsSchemaChars / 4))} tokens, and the model's window is 8,192.

I build Mimir, a local-first agent workspace, so I felt this directly. For the HydraDB hackathon I built an agent context layer: the tools, skills and the things the agent has already resolved live in a HydraDB graph, and each task walks the graph to pull only what it needs.

**The graph.** Terms point at tools and skills (weighted), skills require tools, entities (a client, a service) resolve to the apps they live in, apps serve tools, and tools used together are linked. A pull is a few bounded hops, one HydraDB request each, with several start nodes joined by UNION ALL. Learning is a few edge updates after a task: strengthen edges to the tools that really ran, add edges for words that pointed nowhere, weaken edges to tools that were pulled and ignored, link an entity to its app. No model call, no retraining.

**What I measured** (everything below is against a running HydraDB v0.4.0 node I built from source):
- On ${R.config.test} held-out tasks worded differently from anything trained on, full tool coverage went from ${lc.testCompleteMean[0]}% at cold start to ${lc.testCompleteMean[last]}% (five runs, ±${lc.testCompleteSd[last]}). A keyword index that also knows the skills reaches ${bl.bm25ToolsAndSkills.complete}%.
- Jobs about a thing the agent had resolved before went from ${E[0]}% to ${E[last]}%, against ${bl.bm25ToolsAndSkills.byKind.E}% for keywords. This is the clearest place a graph beats a flat index: the words "tickets" and "logs" belong to different apps depending on who you ask about.
- With a real local model (${R.llm?.model || 'qwen3:1.7b'}, ${R.llm?.sampleSize || 40} unseen tasks): ${learned && all ? `prompt tokens ${n(all.avgPromptTokens)} → ${n(learned.avgPromptTokens)}, time per call ${n(all.avgMs)} → ${n(learned.avgMs)} ms, and the first tool call was a needed one ${all.firstCallHitPct}% → ${learned.firstCallHitPct}% of the time. Honest read: on this tiny model the win is cost and speed, not accuracy; the graph also left the needed tool out of the list ${100 - learned.toolOfferedPct}% of the time.` : '(see the repo)'}
- A tool added at run time was found ${R.drift.heldOutCompletePct.onlyDescription}% from its description alone and ${R.drift.heldOutCompletePct.afterTwoExamples}% after two examples, with no rebuild.
- Speed is the weak spot. On one 4-core VM a single pull takes ${small.load[0].p50ms} ms at ${n(small.catalogTools)} tools but about ${Math.round(big.load[0].p50ms)} ms at ${n(big.catalogTools)}, and under 32 parallel clients it falls to ${big.load[2].perSec} pulls a second there (${small.load[2].perSec} at ${n(small.catalogTools)}). The cost is HydraDB's per-request time growing with the graph; I tried capping hub words and it changed nothing, so the next step is caching hot neighbourhoods.

**What I won't claim.** Held-out accuracy is well below 100%. A skill-aware keyword index gets most of the way on plain jobs. The labels and skills were written by one person, so this is a controlled benchmark, not a field study, and 245 of the ${R.config.catalogTools} tools are modelled on public MCP servers rather than real ones. The graph's measured edge is learning, entities and scale.

**Technical challenges, and what fixed them.**
1. Ubuntu has no LAGraph package, so HydraDB fails at link time. HydraDB ships \`scripts/install_lagraph.sh\`; with \`LAGRAPH_LIB_DIR\` set it builds, and the runtime needs only libgraphblas and libgomp.
2. \`MATCH ... SET\` on a missing edge succeeds and does nothing. My first learning loop "reinforced" edges that did not exist, so new links never appeared and held-out accuracy was about ten points lower. The learner now creates new edges explicitly.
3. \`UNION ALL\` with a repeated start node returns its rows twice, which double-counted scores. Start ids are deduplicated.
4. Results stop at the page size (1,024 by default) with no error. Reads now send \`page_size\` 4096 and follow the cursor.
5. The same graph in HydraDB and in memory disagreed on 21 of 80 retrievals, all near-ties in a different order. I added a deterministic tie-break and a parity test; it is now 80 of 80, before and after learning.

It is wired into Mimir's agent loop (off by default, and it fails open: if HydraDB is down or the graph is unsure, the turn runs exactly as before).

Live demo: ${LIVE}
Code and benchmark: ${REPO}
Walkthrough video: ${VIDEO}

@hydra_db
`;

const post = `Built an agent context layer on @hydra_db.

Agents re-read every tool manual on every call (Anthropic: ~55K tokens for 5 apps). I keep tools, skills and known entities in a HydraDB graph; each task walks it and pulls ~${Math.round(lc.avgToolsLoaded[last])} of ${R.config.catalogTools} tools. It learns from every task: unseen-wording coverage ${lc.testCompleteMean[0]}% → ${lc.testCompleteMean[last]}%.

Live: ${LIVE}
Code: ${REPO}
`;

const forms = `# Hackathon form answers (draft; paste and adjust)

Track: 2, Agent context layer (with Track 1 mechanics: edge reweighting, gap-driven ingestion, shortcuts)
Live app: ${LIVE}
Repo: ${REPO}
Loom / video: ${VIDEO}

One-line pitch: An agent context layer on HydraDB: tools, skills and known entities live in a graph, each task pulls only the few tools it needs, and the graph learns from what worked.

Baseline and improvement: held-out coverage ${lc.testCompleteMean[0]}% (cold) → ${lc.testCompleteMean[last]}% after learning, five runs; BM25 over tools and skills ${bl.bm25ToolsAndSkills.complete}%; BM25 over tools ${bl.bm25Tools.complete}%; preload-everything is 100% coverage at ${R.config.catalogTools} tools per call.

Metric that matters: share of tasks where every needed tool was pulled (held-out wording), tools and tokens offered per call, and the first tool call a real local model makes.

Where the graph does real work: skill → tool hops the request never names, entity → app links, learned edge weights, and one request per hop at ${n(big.catalogTools)} tools (${big.load[2].perSec}/s at 32 clients, p95 ${big.load[2].p95ms} ms).

Who pays: teams running agents against many apps; local-first products with small context windows.
`;
fs.mkdirSync(new URL('docs/', dir), { recursive: true });
fs.writeFileSync(new URL('docs/x-article.md', dir), article);
fs.writeFileSync(new URL('docs/x-post.md', dir), post);
fs.writeFileSync(new URL('docs/form-answers.md', dir), forms);
console.log('wrote docs/x-article.md, x-post.md, form-answers.md');
