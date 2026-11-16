# Hackathon form answers (draft; paste and adjust)

Track: 2, Agent context layer (with Track 1 mechanics: edge reweighting, gap-driven ingestion, shortcuts)
Project name: Context Graph
Live app: https://tooth-refrigerator-achieve-trim.trycloudflare.com
Repo: https://github.com/vaibhav4046/mimir/tree/main/contextgraph
Loom / video: https://www.loom.com/share/2528c92e151447ffb309f0b16df119de

One-line pitch: Small local models run out of context just reading the tool list (264 tools is 15,522 tokens). Context Graph keeps tools and skills in HydraDB and pulls about 6 per task, cutting the prompt to 543 tokens and the time per call by about half.

Technical: metric, baseline, and improvement
- Metric: share of held-out tasks where every needed tool was pulled; tokens and time per call; and the first tool call a real local model (qwen3:1.7b) makes.
- Real small model, 40 unseen tasks, baseline = all 264 tools loaded: prompt 15,522 to 543 tokens, 1,178 to 683 ms per call. First-call accuracy did not improve (42.5% with everything loaded, 35% with the graph).
- Coverage on 80 held-out tasks (held-out wording): 68.8% before learning, 69% after; a keyword index that also learns from the same training tasks 67.5%; keyword search over tools and skills 58.8%, over tools 30%. The movement is in skill jobs (63.3 to 58.7%) and entity jobs, 10 tasks (70 to 100%); plain jobs go 72.5 to 69%, and coverage peaks after one pass (78.8%). Sampling error on 80 tasks is about 5 points.
- Private team words: 0% before any example, 80% after one, 100% after two, no loss on what it knew.
- Where HydraDB does real work: the graph (nodes and every weighted edge) is stored in HydraDB. A pull is a few one-hop UNION ALL reads and a lesson is a handful of edge writes; a restart test shows a graph restored from HydraDB answers identically. An in-process store gives identical answers (parity test, 160 retrievals), so one process does not strictly need HydraDB; durability is the reason for it. I have not tested two processes learning at once. Weak spots: latency grows with catalog size (33 ms at 264 tools, 929 ms at 20,000), and the demo re-seeds on start.

Go-to-market: who wants it, and the social post
- Builders running agents on local or small models with dozens of tools, where the tool list does not fit the context window and there is no Tool Search (Anthropic's Tool Search is the right answer on Claude). First user: my own agent app, Mimir, where it is wired in as an opt-in.
- Possible product: hosted shared tool memory plus an audit log of why each tool was pulled, for teams running agents on small models. The first step would be an agreement with HydraDB. HydraDB's Elastic License 2.0 limits offering it as a managed service, so this would need an agreement with HydraDB, which I have not discussed.
- Social post tagging HydraDB: (paste the tweet link)
