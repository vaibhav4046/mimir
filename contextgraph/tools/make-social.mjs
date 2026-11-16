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
const J = R.jargon;
const { D, S, E } = lc.byKindMean;
const flat = R.flatLearner ? Math.max(...R.flatLearner.rows.slice(1).map(x => x.complete)) : null;
const unseen = Object.fromEntries((R.unseenJobs?.rows || []).map(r => [r.label, r.complete]));
const n = x => Number(x).toLocaleString('en-US');
const tools = Math.round(lc.avgToolsLoaded[last]);
const preload = all ? n(all.avgPromptTokens) : n(Math.round(R.config.allToolsSchemaChars / 4));
const pulled = learned ? n(learned.avgPromptTokens) : '?';

const article = `# A memory for agent tools, built on HydraDB: ${tools} of ${R.config.catalogTools} tools per task

A small local model has an 8,192-token window. The list of tools I wanted it to use came to ${preload} tokens as the model counts them, so it was out of room before it read my request.

Anthropic measured five connected apps at about 55,000 tokens before the first word, and has seen 134,000. Their Tool Search tool fixes this for Claude by loading tools on demand, and it works: if you are on Claude, use it. Many agent hosts and most small local models have nothing like it, and as far as I can tell it does not remember which app a client lives in or learn from what you tell it. That gap is what I built for the HydraDB hackathon. It is called Context Graph, and it is for people who run agents on local or small models with a lot of tools.

I build Mimir, a local-first agent workspace, so I felt this directly. In Context Graph the tools, skills and the things the agent has already resolved live in a HydraDB graph, and each task walks the graph to pull only what it needs.

**The graph.** Words point at tools and skills (weighted), skills require tools, entities (a client, a service) resolve to the apps they live in, and apps serve tools. (Tools used together are also recorded, but I turned that boost off because it hurt jobs the graph had not seen.) A pull is a few bounded hops, one HydraDB request each, with several start nodes joined by UNION ALL. Learning is a few edge updates after a task: strengthen edges to the tools that really ran, add edges for words that pointed nowhere, weaken edges to tools that were pulled and ignored, link an entity to its app. No model call, no retraining.

**What I measured** (against a running HydraDB v0.4.0 node I built from source):
- With a real small model (${R.llm?.model || 'qwen3:1.7b'} through Ollama, ${R.llm?.sampleSize || 40} unseen tasks): ${learned && all ? `the prompt went from ${n(all.avgPromptTokens)} to ${n(learned.avgPromptTokens)} tokens and a call from ${n(all.avgMs)} to ${n(learned.avgMs)} ms. The first tool call was a needed one ${all.firstCallHitPct}% of the time with everything loaded and ${learned.firstCallHitPct}% with the graph. So I saved the cost and the time and did not improve accuracy; the graph left the needed tool out of the list ${100 - learned.toolOfferedPct}% of the time.` : '(see the repo)'}
- On ${R.config.test} held-out tasks, coverage (every needed tool pulled) went from ${lc.testCompleteMean[0]}% before learning to ${lc.testCompleteMean[last]}% after. A keyword index that also knows the skills reaches ${bl.bm25ToolsAndSkills.complete}%, plain keyword search ${bl.bm25Tools.complete}%. A keyword index that also learns from the same training tasks reaches ${flat}%, so the graph is not measurably better than a simple learner here (the sampling error on 80 tasks is about 5 points). The gain is not spread evenly: plain jobs (40 tasks) go ${D[0]}% to ${D[last]}%, skill jobs (30) go ${S[0]}% to ${S[last]}%, and jobs about a thing the agent had resolved before (10) go ${E[0]}% to ${E[last]}%. Coverage peaks after the first pass (${lc.testCompleteMean[1]}%) and drifts down with more passes over the same examples.
${J ? `- Private team words: ten made-up words (like "bluebird") were found ${J.heldOut.cold}% of the time before any example, ${J.heldOut.afterOneExample}% after one, and ${J.heldOut.afterTwoExamples}% after two, with no loss on what it already knew. Plain keyword search scores 0 on them; I did not test a keyword index that learns on this one.\n` : ''}${R.unseenJobs ? `- Jobs it has never seen: I trained on half of the jobs and tested on the other half. The untrained graph got ${unseen['Graph, cold start']}% and after learning ${unseen['Graph, after learning']}%; keyword search with skills got ${unseen['Keyword search over tools and skills (no learning)']}% and a learning keyword index ${unseen['Keyword search that learns (experience documents)']}%. My first learner settings made this worse (72.1% down to 60.4%), because words shared across jobs pulled the wrong tools. I turned off one boost and weakened new links, which fixed most of it, but I chose those two settings after seeing this test. The graph ends ahead of the learning keyword index here, but it was already ahead before any learning (${unseen['Graph, cold start']}%), so that comes from its skill and similar-word structure, not from learning.\n` : ''}- A tool added at run time with no rebuild was found ${R.drift.heldOutCompletePct.onlyDescription}% of the time from its description alone and ${R.drift.heldOutCompletePct.afterTwoExamples}% after two examples. This is a separate test from the private-words one.
- Speed is the weak spot. On one 4-core VM a pull takes about ${Math.round(small.load[0].p50ms)} ms at ${n(small.catalogTools)} tools and about ${Math.round(big.load[0].p50ms)} ms at ${n(big.catalogTools)}, and with 32 parallel clients the larger catalog manages ${big.load[2].perSec} pulls a second (${small.load[2].perSec} at ${n(small.catalogTools)}). I do not yet know why; capping very common words changed nothing, so the next thing I would try is caching hot neighbourhoods.

**What I won't claim.** "Held-out" here means held-out wording, not held-out jobs: every job appears in training in two other phrasings, and I wrote the skills from the same ground truth as the skill-job labels, so the skill-job gain is partly in-distribution. With 80 tasks the sampling error is about 5 points, so treat the average gain as suggestive and the entity result (10 jobs) as a pattern, not a proof. A keyword index that also learns reaches about the same coverage as the graph, so I cannot claim the graph is better at learning.I wrote the tasks and labels myself, and ${R.config.catalogTools - R.config.realMimirTools} of the ${R.config.catalogTools} tools are modelled on public MCP servers rather than real ones.

**Why HydraDB and not a map in memory.** An in-process store gives the same answers (my parity test compares them on 160 retrievals, before and after learning), so for one process a map is enough. HydraDB holds all of the state outside the app: nodes, weighted edges, and every lesson. Any number of agent processes can read and learn from the same graph, and it keeps working if one of them dies. Today my demo server re-seeds the graph on start; re-attaching to a stored graph is not finished yet.

**Technical challenges, and what fixed them.**
1. Ubuntu has no LAGraph package, so HydraDB fails at link time. HydraDB ships \`scripts/install_lagraph.sh\`; with \`LAGRAPH_LIB_DIR\` set it builds, and the runtime needs only libgraphblas and libgomp.
2. \`MATCH ... SET\` on a missing edge succeeds and does nothing. My first learning loop "reinforced" edges that did not exist, so new links never appeared and held-out accuracy was about ten points lower. The learner now creates new edges explicitly.
3. \`UNION ALL\` with a repeated start node returns its rows twice, which double-counted scores. Start ids are deduplicated.
4. Results stop at the page size (1,024 by default) with no error. Reads now send \`page_size\` 4096 and follow the cursor.
5. The same graph in HydraDB and in memory disagreed on 21 of 80 retrievals, all near-ties in a different order. I added a deterministic tie-break and a parity test; it is now 80 of 80.

**Who it is for, and what could be a business.** Builders running agents on local or small models with dozens of tools, where the tool list does not fit the window and there is no Tool Search. Mimir is my own first user: Context Graph is wired into its agent loop, off by default, and it fails open, so if HydraDB is down or the graph is unsure the turn runs exactly as before. The code is open source. If this became a product, the paid part would be a hosted version where a team's agents share what they have learned and every pull is logged. HydraDB is under the Elastic License 2.0, which limits offering it as a managed service, so a hosted product would need an agreement with the HydraDB team. I have not discussed that with them.

Live demo: ${LIVE}
Code and benchmark: ${REPO}
Walkthrough video: ${VIDEO}

@hydra_db
`;

const post = `My agent's tool list was ${preload} tokens before it read my request. Context Graph keeps tools in @hydra_db and pulls ~${tools} of ${R.config.catalogTools} per task: ${preload} to ${pulled} tokens, about half the time per call. It doesn't make a tiny model more accurate. Code, demo and write-up: ${REPO}`;
const postLen = post.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;
if (postLen > 280) console.error(`WARNING: x-post is ${postLen} characters with links counted as 23 each; limit is 280`);

const forms = `# Hackathon form answers (draft; paste and adjust)

Track: 2, Agent context layer (with Track 1 mechanics: edge reweighting, gap-driven ingestion, shortcuts)
Project name: Context Graph
Live app: ${LIVE}
Repo: ${REPO}
Loom / video: ${VIDEO}

One-line pitch: A memory for agent tools on HydraDB: each task pulls the ${tools} tools it needs out of ${R.config.catalogTools} instead of loading all of them, and the graph learns from what worked.

Technical: metric, baseline, and improvement
- Metric: share of held-out tasks where every needed tool was pulled; tokens and time per call; and the first tool call a real local model (${R.llm?.model || 'qwen3:1.7b'}) makes.
- Real small model, ${R.llm?.sampleSize || 40} unseen tasks, baseline = all ${R.config.catalogTools} tools loaded: prompt ${preload} to ${pulled} tokens, ${learned && all ? `${n(all.avgMs)} to ${n(learned.avgMs)} ms per call` : ''}. First-call accuracy did not improve (${all?.firstCallHitPct}% with everything loaded, ${learned?.firstCallHitPct}% with the graph).
- Coverage on ${R.config.test} held-out tasks (held-out wording): ${lc.testCompleteMean[0]}% before learning, ${lc.testCompleteMean[last]}% after; a keyword index that also learns from the same training tasks ${flat}%; keyword search over tools and skills ${bl.bm25ToolsAndSkills.complete}%, over tools ${bl.bm25Tools.complete}%. The movement is in skill jobs (${S[0]} to ${S[last]}%) and entity jobs, 10 tasks (${E[0]} to ${E[last]}%); plain jobs go ${D[0]} to ${D[last]}%, and coverage peaks after one pass (${lc.testCompleteMean[1]}%). Sampling error on 80 tasks is about 5 points.
${J ? `- Private team words: ${J.heldOut.cold}% before any example, ${J.heldOut.afterOneExample}% after one, ${J.heldOut.afterTwoExamples}% after two, no loss on what it knew.\n` : ''}- Where HydraDB does real work: all graph state lives in HydraDB (nodes, weighted edges, every lesson). A pull is four one-hop UNION ALL reads and a lesson is a handful of edge writes, so many agent processes can share one graph. An in-process store gives identical answers (parity test, 160 retrievals), so a single process does not need HydraDB; sharing and durability are the reason for it. Weak spots: latency grows with catalog size (${Math.round(small.load[0].p50ms)} ms at ${n(small.catalogTools)} tools, ${Math.round(big.load[0].p50ms)} ms at ${n(big.catalogTools)}), and the demo re-seeds on start.

Go-to-market: who wants it, and the social post
- Builders running agents on local or small models with dozens of tools, where the tool list does not fit the context window and there is no Tool Search (Anthropic's Tool Search is the right answer on Claude). First user: my own agent app, Mimir, where it is wired in as an opt-in.
- Possible product: a hosted version where a team's agents share what they have learned and every pull is logged. HydraDB's Elastic License 2.0 limits offering it as a managed service, so this would need an agreement with HydraDB, which I have not discussed.
- Social post tagging HydraDB: (paste the tweet link)
`;
fs.mkdirSync(new URL('docs/', dir), { recursive: true });
fs.writeFileSync(new URL('docs/x-article.md', dir), article);
fs.writeFileSync(new URL('docs/x-post.md', dir), post + '\n');
fs.writeFileSync(new URL('docs/form-answers.md', dir), forms);
console.log(`wrote docs/x-article.md, x-post.md (${postLen} chars), form-answers.md`);
