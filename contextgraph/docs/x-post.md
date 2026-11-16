Built an agent context layer on @hydra_db.

Agents re-read every tool manual on every call (Anthropic: ~55K tokens for 5 apps). I keep tools, skills and known entities in a HydraDB graph; each task walks it and pulls ~6 of 264 tools. It learns from every task: unseen-wording coverage 60% → 69.3%.

Live: http://127.0.0.1:7860
Code: https://github.com/vaibhav4046/mimir
