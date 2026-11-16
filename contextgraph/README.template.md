# Context Graph: an agent context layer on HydraDB

**Your agent shouldn't read {{TOOLS}} tool manuals before it reads your request.**
Context Graph keeps an agent's tools, skills and the things it has already resolved in a [HydraDB](https://github.com/hydra-db/hydradb) graph.
For each task the agent walks the graph and pulls only the few tools the task needs, and it adjusts its links when it is told what worked.

- **Live demo:** {{LIVE}}
- **Video walkthrough:** {{VIDEO}}
- **Track:** 2, the agent context layer (with Track 1's continual-learning mechanics: edge reweighting, gap-driven ingestion, path shortcuts)
- **Built on:** HydraDB v0.4.0, built from source and run by us (not the hosted platform). The benchmark, the scale test and the local-model test ran against a running HydraDB node; the two comparison tests (a keyword index that learns, and jobs it has never seen) run in process, and the in-process store matches HydraDB exactly in the parity test.
- **Wired into a real agent:** [Mimir](https://github.com/vaibhav4046/mimir)'s agent loop can use it (`daemon/context-graph.mjs`). It is opt-in, off by default, and fails open.

## The problem

Every tool an agent can call is described to the model in the prompt, on every call.

| What was measured | Result | Source |
|---|---|---|
| Five connected apps (GitHub, Slack, Sentry, Grafana, Splunk), 58 tools | about 55K tokens before the first word; 134K seen at Anthropic | [Anthropic Engineering, Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use) |
| Loading tools on demand instead | 85% fewer tokens; Opus 4 accuracy 49% to 74% on Anthropic's MCP evaluations | same |
| Tool selection by retrieval vs loading everything | 43.13% vs 13.62%, over 50% fewer prompt tokens | [RAG-MCP, arXiv 2505.03275](https://arxiv.org/abs/2505.03275) |
| One popular server | 93 tools, about 55K tokens | [Simon Willison, 22 Aug 2025](https://simonwillison.net/2025/Aug/22/too-many-mcps/) |

Cost is the visible part: 55,000 tokens on 1,000 calls a day is 1.65 billion tokens a month for the tool list alone
(about $4,950 at an example $3 per million input tokens; much less with prompt caching).
For a small local model the tool list may not fit at all: this repo's {{TOOLS}}-tool catalog came to {{PRELOAD_TOKENS}} tokens as a local model counted them, larger than the 8,192-token window Mimir gives a local model by default.

## Where this fits

Anthropic's Tool Search tool loads tools on demand for Claude, and it works: if you run on Claude, use it. Context Graph is for the cases it does not cover: agent hosts and small local models with no tool search, and an agent that should remember things Tool Search has no place for (which app a client lives in, which tools get used together) and adjust from what you tell it. It is aimed at builders running local or small models with dozens of tools. Mimir is the first user. It does not beat Tool Search on Claude and does not try to.

## Why HydraDB

An in-process store gives identical answers (`node test/parity.mjs` compares it with HydraDB on 160 retrievals, before and after learning), so for a single process a plain map would be enough. HydraDB stores the graph: the nodes and every weighted edge, so a lesson is a durable write in a database the agent does not own. The app keeps small lookup tables in memory (names and word counts) and `restore()` rebuilds them from HydraDB after a restart (`node test/restore.mjs` checks that a restored graph answers all 80 held-out tasks identically). What I have not built or tested: two processes learning into one graph at once. A lesson is a read, then a write, with no lock, so concurrent writers could create duplicate edges or lose an update. The demo server also re-seeds on start instead of restoring.

## How it works

The graph (all of it lives in HydraDB):

| Edge | Meaning |
|---|---|
| `Term -MENTIONS{w}-> Tool or Skill` | what a word points at; `w` is learned |
| `Term -SIMILAR{w}-> Term` | bridge from unfamiliar wording to a known word (small embedding model, built offline) |
| `Skill -REQUIRES-> Tool` | the tools a known procedure needs, even if the request never names them |
| `Entity -RESOLVES_TO{w}-> Server` | where a thing the agent already resolved lives |
| `Server -SERVES-> Tool` | which app a tool belongs to |
| `Tool -NEXT{w}-> Tool` | tools used together before (recorded, but its retrieval boost is off: it hurt jobs the graph had not seen) |

**One pull** is a few bounded hops, one HydraDB request each (several start nodes joined with `UNION ALL`):
words, then similar words, then tools and skills, then skills' required tools, then entities' systems' tools (and tools used together, whose boost is off by default).
It returns the top 6 tools when the match is strong (`score >= 1`), or widens up to 12 (`kWeak: 12`) when the match is weak so fewer needed tools are dropped, and flags when it is unsure so the agent can fall back.

**Learning** is a few edge updates after a task, from the tools that really ran: strengthen edges to used tools, add edges for words that pointed nowhere
(gap-driven ingestion, which also turns a skill-reached tool into a direct shortcut), weaken edges to tools that were pulled and ignored,
link an entity to the system it turned out to live in, record tools used together. No model call, no retraining.

**In the live lab:** a one-click 30-second guided demo (picks a task the shared graph still misses, teaches it, and tests two unseen rewordings), a side-by-side `$` per 1,000 calls comparison against preloading and keyword search, and **Try it on your own tools** (`POST /api/custom`, up to 150 tools, seeded into its own private HydraDB namespace).

## Results

{{RESULTS}}

### Cold-start ablation (80 held-out tasks, in process)
Runs `node bench/ablation.mjs` (`k: 6`, `kWeak: 12`) against the in-process store (which matches HydraDB in `test/parity.mjs`).

| Variant | Complete | Plain (D) | Skill (S) | Entity (E) |
| --- | ---: | ---: | ---: | ---: |
| Full cold graph | 68.8% | 72.5% | 63.3% | 70.0% |
| No similar-word bridge | 58.8% | 60.0% | 56.7% | 60.0% |
| No skills | 45.0% | 67.5% | 3.3% | 80.0% |

Note: the similar-word vocabulary (`data/similar.json`) was built from all task text including held-out wording (no labels), so the 10-point drop without the bridge is partly in-distribution.

### AI-simulated persona review (not real users)
Before the final polish, an AI-simulated 6-persona panel scored the product `3, 3, 2, cite-2/recommend-5, 3, 5` (out of 10). Addressed from that review: fixed the `/api/feedback` whitespace split bug, added the 30-second guided demo (always picks an unlearned task), added the side-by-side `$` comparison and plain-language summary, fixed mobile layout and the 3-column graph view, added "Try it on your own tools" (`POST /api/custom`), and added HydraDB request timeouts. Still open: no drop-in MCP gateway or npm package yet, and no multi-tenant auth on the shared demo.

## Honest limits

- The {{MODELLED}} tools that are not Mimir's own are modelled on the public MCP servers of the same names. Nothing here executes them.
- Task labels, skills and entity links were written by one person. This is a controlled benchmark, not a field study. The next step is replaying real agent logs.
- "Held-out" means held-out wording, not held-out jobs. Each job appears in training in two other phrasings, and the 30 skills were written from the same ground truth as the skill-job labels, so the skill-job gain is partly in-distribution.
- The learning gain is concentrated: plain jobs (40 held-out tasks) move only a little, skill jobs (30) and entity jobs (only 10) more. Coverage peaks after the first training pass and drifts down with more passes over the same examples. With 80 tasks the sampling error is about 5 points. The "±" in the tables is the spread over training-order shuffles on one fixed test set, not a confidence interval.
- Preload-everything shows 100% because it hands over every tool by construction; that number is not measured.
- I tuned after seeing test results, three times: the "strong" confidence threshold (1.0) was picked from a sweep over held-out rows; two learner settings (`coUseBoost` to 0, `newEdge` to 0.12) were changed after the unseen-jobs test showed the first settings hurt (moving 5-pass held-out from 69.3% to {{AFTER}}%); and adaptive size (`kWeak: 12`) was chosen from a 3-option grid on held-out tasks. Held-out figures that were also used to choose settings should be read with that in mind.
- Held-out accuracy is well below 100%. The graph does not understand language; it follows learned links. It helps most when wording varies, a thing is known, or the catalog is large.
- A keyword index that knows the skills reaches {{BM25S}}% on the same tasks, and one that also learns from the same training tasks reaches {{FLAT}}%, about what the graph gets after learning. On this benchmark the graph is not measurably better than a flat index that stores past tasks. What it adds is a visible path for every pull and state kept outside the app process, in HydraDB.
- Learning on other jobs can hurt a job the graph has not seen. Training on half of the jobs and testing on the other half lowered coverage under the first settings I tried (72.1% cold to 60.4%). I then turned off the co-use boost and weakened new links, which brought it back to {{UNSEEN}}; I chose those two settings after seeing that test, so it is no longer fully untouched.
- On a real small model (qwen3:1.7b through Ollama, 40 unseen tasks) the graph cut the prompt from about 15,500 to about 500 tokens and the time per call roughly in half, but it did **not** improve first-call accuracy: {{LLM_GRAPH}}% against {{LLM_ALL}}% with every tool loaded, because the needed tool was missing from the pulled list on {{LLM_MISS}}% of tasks. The measured win there is cost and speed, not correctness.
- The semantic bridge uses single-word embeddings from `all-minilm`, which are noisy. Its vocabulary was built from the catalog and all task words including held-out (no labels).
- HydraDB's query dialect is narrow (no expressions in `RETURN`, one relationship type per pattern, no property writes in batch shapes). The design works inside it; see `src/store-hydradb.mjs` for the shapes used and why.
- Load numbers come from one 4-core WSL VM with HydraDB and the load generator on the same machine.

## Run it

```bash
# 1. HydraDB (Linux or WSL). See https://github.com/hydra-db/hydradb for prerequisites.
git clone https://github.com/hydra-db/hydradb && cd hydradb
bash scripts/install_lagraph.sh /opt/lagraph
LAGRAPH_LIB_DIR=/opt/lagraph/lib RUST_MIN_STACK=33554432 cargo build --release --locked --features server-runtime --bin graph-node
bash <this repo>/contextgraph/tools/start-hydradb.sh ./target/release/graph-node    # http on :18443

# 2. The demo and the benchmark (Node 20+, no dependencies)
cd contextgraph
node app/server.mjs                 # http://127.0.0.1:7860
node bench/run.mjs                  # learning curves, baselines, drift  -> results/results.json (overwrites it, so run this first)
node bench/jargon.mjs               # private team words, with a no-forgetting check
node bench/scale.mjs                # catalog size and load
node bench/flat-learner.mjs         # a keyword index that also learns, in process
node bench/unseen-jobs.mjs          # train on half the jobs, test on the rest, in process
node bench/llm-eval.mjs results/selections.json results/llm.json qwen3:1.7b   # real local model, needs Ollama
node test/parity.mjs                # HydraDB store and in-process store agree exactly
node test/restore.mjs               # a restored graph answers exactly like the original
node --test ../tests/context-graph.test.mjs   # only inside the Mimir repo, where daemon/context-graph.mjs lives
```

Use it from code:

```js
import { HydraStore } from './src/store-hydradb.mjs';
import { ContextGraph } from './src/graph.mjs';
const g = new ContextGraph(new HydraStore({ url: 'http://127.0.0.1:18443', token: '...' }));
await g.seed({ tools, skills, servers });
const { tools: pulled, confident } = await g.retrieve('Block two hours on Friday for planning');
await g.learn({ text, used: ['calendar__create_event'], retrieved: pulled.map(t => t.id) });
```

## Layout

`src/` graph, HydraDB store, in-process store, BM25 baseline · `data/` catalog, skills, tasks, similar-word links · `bench/` benchmark · `app/` demo server and UI · `tools/` evidence screenshots, narration and video recorder · `space/` Docker Space.
HydraDB is licensed under the Elastic License 2.0 (see its repository); this code only talks to it over its public query API.
