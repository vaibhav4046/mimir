# Teaching an agent to carry five tools instead of two hundred and sixty-four, with HydraDB

Every tool an AI agent can call is described to the model in the prompt, on every call. Anthropic measured five connected apps at about 55,000 tokens before the first word, and has seen 134,000. A retrieval paper (RAG-MCP) found tool-selection accuracy going from 13.6% to 43.1% when tools are retrieved instead of loaded. On a small local model the list may not even fit: my 264-tool test catalog is about 19,090 tokens, and the model's window is 8,192.

I build Mimir, a local-first agent workspace, so I felt this directly. For the HydraDB hackathon I built an agent context layer: the tools, skills and the things the agent has already resolved live in a HydraDB graph, and each task walks the graph to pull only what it needs.

**The graph.** Terms point at tools and skills (weighted), skills require tools, entities (a client, a service) resolve to the apps they live in, apps serve tools, and tools used together are linked. A pull is a few bounded hops, one HydraDB request each, with several start nodes joined by UNION ALL. Learning is a few edge updates after a task: strengthen edges to the tools that really ran, add edges for words that pointed nowhere, weaken edges to tools that were pulled and ignored, link an entity to its app. No model call, no retraining.

**What I measured** (everything below is against a running HydraDB v0.4.0 node I built from source):
- On 80 held-out tasks worded differently from anything trained on, full tool coverage went from 60% at cold start to 69.3% (five runs, ±0.6). A keyword index that also knows the skills reaches 58.8%.
- Jobs about a thing the agent had resolved before went from 70% to 94%, against 50% for keywords. This is the clearest place a graph beats a flat index: the words "tickets" and "logs" belong to different apps depending on who you ask about.
- With a real local model (qwen3:1.7b, 40 unseen tasks): prompt tokens 15,522 → 504, time per call 1,061 → 541 ms, and the first tool call was a needed one 42.5% → 32.5% of the time. Honest read: on this tiny model the win is cost and speed, not accuracy; the graph also left the needed tool out of the list 25% of the time.
- A tool added at run time was found 60% from its description alone and 80% after two examples, with no rebuild.
- Speed is the weak spot. On one 4-core VM a single pull takes 33.3 ms at 264 tools but about 929 ms at 20,000, and under 32 parallel clients it falls to 7 pulls a second there (110 at 264). The cost is HydraDB's per-request time growing with the graph; I tried capping hub words and it changed nothing, so the next step is caching hot neighbourhoods.

**What I won't claim.** Held-out accuracy is well below 100%. A skill-aware keyword index gets most of the way on plain jobs. The labels and skills were written by one person, so this is a controlled benchmark, not a field study, and 245 of the 264 tools are modelled on public MCP servers rather than real ones. The graph's measured edge is learning, entities and scale.

**Technical challenges, and what fixed them.**
1. Ubuntu has no LAGraph package, so HydraDB fails at link time. HydraDB ships `scripts/install_lagraph.sh`; with `LAGRAPH_LIB_DIR` set it builds, and the runtime needs only libgraphblas and libgomp.
2. `MATCH ... SET` on a missing edge succeeds and does nothing. My first learning loop "reinforced" edges that did not exist, so new links never appeared and held-out accuracy was about ten points lower. The learner now creates new edges explicitly.
3. `UNION ALL` with a repeated start node returns its rows twice, which double-counted scores. Start ids are deduplicated.
4. Results stop at the page size (1,024 by default) with no error. Reads now send `page_size` 4096 and follow the cursor.
5. The same graph in HydraDB and in memory disagreed on 21 of 80 retrievals, all near-ties in a different order. I added a deterministic tie-break and a parity test; it is now 80 of 80, before and after learning.

It is wired into Mimir's agent loop (off by default, and it fails open: if HydraDB is down or the graph is unsure, the turn runs exactly as before).

Live demo: http://127.0.0.1:7860
Code and benchmark: https://github.com/vaibhav4046/mimir
Walkthrough video: (add the Loom link)

@hydra_db
