# Hackathon form answers (draft; paste and adjust)

Track: 2, Agent context layer (with Track 1 mechanics: edge reweighting, gap-driven ingestion, shortcuts)
Project name: Context Graph
Live app: https://tooth-refrigerator-achieve-trim.trycloudflare.com
Repo: https://github.com/vaibhav4046/mimir/tree/main/contextgraph
Loom / video: (add the Loom link)

One-line pitch: A memory for agent tools on HydraDB: each task pulls the 6 tools it needs out of 264 instead of loading all of them, and the graph learns from what worked.

Technical: metric, baseline, and improvement
- Metric: share of held-out tasks where every needed tool was pulled; tokens and time per call; and the first tool call a real local model (qwen3:1.7b) makes.
- Real small model, 40 unseen tasks, baseline = all 264 tools loaded: prompt 15,522 to 494 tokens, 1,071 to 580 ms per call. First-call accuracy did not improve (42.5% with everything loaded, 35% with the graph).
- Coverage on 80 held-out tasks (held-out wording): 60% before learning, 66.8% after; a keyword index that also learns from the same training tasks 67.5%; keyword search over tools and skills 58.8%, over tools 30%. The movement is in skill jobs (53.3 to 58%) and entity jobs, 10 tasks (70 to 100%); plain jobs go 62.5 to 65%, and coverage peaks after one pass (72.8%). Sampling error on 80 tasks is about 5 points.
- Private team words: 0% before any example, 80% after one, 100% after two, no loss on what it knew.
- Where HydraDB does real work: all graph state lives in HydraDB (nodes, weighted edges, every lesson). A pull is four one-hop UNION ALL reads and a lesson is a handful of edge writes, so many agent processes can share one graph. An in-process store gives identical answers (parity test, 160 retrievals), so a single process does not need HydraDB; sharing and durability are the reason for it. Weak spots: latency grows with catalog size (33 ms at 264 tools, 929 ms at 20,000), and the demo re-seeds on start.

Go-to-market: who wants it, and the social post
- Builders running agents on local or small models with dozens of tools, where the tool list does not fit the context window and there is no Tool Search (Anthropic's Tool Search is the right answer on Claude). First user: my own agent app, Mimir, where it is wired in as an opt-in.
- Possible product: a hosted version where a team's agents share what they have learned and every pull is logged. HydraDB's Elastic License 2.0 limits offering it as a managed service, so this would need an agreement with HydraDB, which I have not discussed.
- Social post tagging HydraDB: (paste the tweet link)
