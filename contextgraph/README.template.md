# Context Graph: an agent context layer on HydraDB

**Your agent shouldn't read {{TOOLS}} tool manuals before it reads your request.**
Context Graph keeps an agent's tools, skills and the things it has already resolved in a [HydraDB](https://github.com/hydra-db/hydradb) graph.
For each task the agent walks the graph and pulls only the few tools the task needs, and the graph gets sharper every time it is told what worked.

- **Live demo:** {{LIVE}}
- **Video walkthrough:** {{VIDEO}}
- **Track:** 2, the agent context layer (with Track 1's continual-learning mechanics: edge reweighting, gap-driven ingestion, path shortcuts)
- **Built on:** HydraDB v0.4.0, built from source and run by us (not the hosted platform). Every graph number below was measured against a running HydraDB node.
- **Used in production code:** it is wired into [Mimir](https://github.com/vaibhav4046/mimir)'s agent loop (`daemon/context-graph.mjs`), off by default, and fails open.

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
For a small local model the tool list may not fit at all: this repo's {{TOOLS}}-tool catalog is about {{PRELOAD_TOKENS}} tokens, larger than the 8,192-token window Mimir gives a local model by default.

## How it works

The graph (all of it lives in HydraDB):

| Edge | Meaning |
|---|---|
| `Term -MENTIONS{w}-> Tool or Skill` | what a word points at; `w` is learned |
| `Term -SIMILAR{w}-> Term` | bridge from unfamiliar wording to a known word (small embedding model, built offline) |
| `Skill -REQUIRES-> Tool` | the tools a known procedure needs, even if the request never names them |
| `Entity -RESOLVES_TO{w}-> Server` | where a thing the agent already resolved lives |
| `Server -SERVES-> Tool` | which app a tool belongs to |
| `Tool -NEXT{w}-> Tool` | tools used together before |

**One pull** is a few bounded hops, one HydraDB request each (several start nodes joined with `UNION ALL`):
words, then similar words, then tools and skills, then skills' required tools, then entities' systems' tools, then tools used together.
It returns the best few tools with the reason for each, or says it is unsure so the agent can fall back.

**Learning** is a few edge updates after a task, from the tools that really ran: strengthen edges to used tools, add edges for words that pointed nowhere
(gap-driven ingestion, which also turns a skill-reached tool into a direct shortcut), weaken edges to tools that were pulled and ignored,
link an entity to the system it turned out to live in, link tools used together. No model call, no retraining.

## Results

{{RESULTS}}

## Honest limits

- The {{MODELLED}} tools that are not Mimir's own are modelled on the public MCP servers of the same names. Nothing here executes them.
- Task labels, skills and entity links were written by one person. This is a controlled benchmark, not a field study. The next step is replaying real agent logs.
- Held-out accuracy is well below 100%. The graph does not understand language; it follows learned links. It helps most when wording varies, a thing is known, or the catalog is large.
- A flat keyword index that also knows the skills reaches {{BM25S}}% on the same tasks, so the graph's measured edge is learning, entities and scale, not a better first guess.
- On a real small model (qwen3:1.7b through Ollama, 40 unseen tasks) the graph cut the prompt from about 15,500 to about 500 tokens and the time per call roughly in half, but it did **not** improve first-call accuracy: 32.5% against 42.5% with every tool loaded, because the needed tool was missing from the pulled list on 25% of tasks. The measured win there is cost and speed, not correctness.
- The semantic bridge uses single-word embeddings from `all-minilm`, which are noisy. Its vocabulary was built from the catalog and the task words (no labels), so unseen vocabulary is simply ignored.
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
node bench/run.mjs                  # learning curves, baselines, drift  -> results/results.json
node bench/scale.mjs                # catalog size and load
node bench/llm-eval.mjs results/selections.json results/llm.json qwen3:1.7b   # real local model, needs Ollama
node test/parity.mjs                # HydraDB store and in-process store agree exactly
node --test ../tests/context-graph.test.mjs
```

Use it from code:

```js
import { HydraStore } from './src/store-hydradb.mjs';
import { ContextGraph } from './src/graph.mjs';
const g = new ContextGraph(new HydraStore({ url: 'http://127.0.0.1:18443', token: '...' }));
await g.seed({ tools, skills, servers });             // or g.restore() when the graph already exists
const { tools: pulled, confident } = await g.retrieve('Block two hours on Friday for planning');
await g.learn({ text, used: ['calendar__create_event'], retrieved: pulled.map(t => t.id) });
```

## Layout

`src/` graph, HydraDB store, in-process store, BM25 baseline · `data/` catalog, skills, tasks, similar-word links · `bench/` benchmark · `app/` demo server and UI · `tools/` evidence screenshots, narration and video recorder · `space/` Docker Space.
HydraDB is licensed under the Elastic License 2.0 (see its repository); this code only talks to it over its public query API.
