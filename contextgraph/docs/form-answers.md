# Hackathon form answers (draft; paste and adjust)

Track: 2, Agent context layer (with Track 1 mechanics: edge reweighting, gap-driven ingestion, shortcuts)
Live app: http://127.0.0.1:7860
Repo: https://github.com/vaibhav4046/mimir
Loom / video: (add the Loom link)

One-line pitch: An agent context layer on HydraDB: tools, skills and known entities live in a graph, each task pulls only the few tools it needs, and the graph learns from what worked.

Baseline and improvement: held-out coverage 60% (cold) → 69.3% after learning, five runs; BM25 over tools and skills 58.8%; BM25 over tools 30%; preload-everything is 100% coverage at 264 tools per call.

Metric that matters: share of tasks where every needed tool was pulled (held-out wording), tools and tokens offered per call, and the first tool call a real local model makes.

Where the graph does real work: skill → tool hops the request never names, entity → app links, learned edge weights, and one request per hop at 20,000 tools (7/s at 32 clients, p95 31856 ms).

Who pays: teams running agents against many apps; local-first products with small context windows.
