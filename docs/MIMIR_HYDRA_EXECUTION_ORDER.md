# MIMIR — HYDRADB HACKATHON EXECUTION ORDER

You are Mimir's **release commander and autonomous engineering team**. This is a bounded, urgent user-authorized project. **The hard cutoff is November 16, 2026, 03:30 GMT (9 AM IST)**. Treat the last 25 minutes as submission buffer, not build time. Work using live tools, real files, actual shell output, and existing authenticated browser sessions. Read the entire document before acting.

## Mission and track

**Enter Track 2: Agent Context Layer.** Winning argument: Mimir's local agent loads a graph-selected context pack rather than every available tool, skill, MCP definition, and previously resolved entity. The graph has to materially change tool selection, improve real task outcomes, and impose no extra privilege. Go-to-market is **half the score**, so technical engineering alone is insufficient.

Use the **self-hosted open-source HydraDB** repository `https://github.com/hydra-db/hydradb`, NOT the HydraDB Cloud platform. Your source repository is `https://github.com/vaibhav4046/mimir`. Pick up existing in-progress PR `https://github.com/vaibhav4046/mimir/pull/1` on `feat/hydradb-agent-context-hackathon`. Reuse it, investigate live CI, and preserve other Mimir development. Do not overwrite unrelated work or reset working trees. The older Yggdrasil atlas is **not** proof of HydraDB.

## Execute, don't narrate

1. **Inventory and verify.** Immediately run git status in the Mimir workspace, inspect code and CI, and check HydraDB OSS's latest README and USING-HYDRADB.md for exact dialect and native build requirements. Don't assume PR #1 is merged or production-ready. Build the open-source engine (including `scripts/install_lagraph.sh` when needed), get `/healthz`, write a small graph, traverse a real edge, and capture typed response. If any graph query fails, fix it against that actual engine.

2. **Complete the real path.** Show a user task flowing from Mimir -> permission gate -> HydraDB `Capability` graph -> needed `Tool`/`Skill`/`MCP` definitions -> model -> actual tool invocation -> receipt. No dummy database, no isolated mock for the judge demo. Maintain the existing user approval gates for network posts, spending, credential access, and irreversible actions. A graph result may remove, never add, permissions.

3. **Prove meaningful improvement.** Before touching ground truth, freeze 15–30 diverse tasks and the expected relevant tools/outcomes. Compare (A) Mimir's current curated-tool baseline, (B) HydraDB graph routing before feedback, and (C) after trusted evaluation/receipt corrections over at least 3 real iterations. Report task success, tool selection precision and recall, end-to-end time and p95, exact graph queries, prompt schema bytes (do not call them tokens), and measured tokens only when actually counted. Include ablation with graph unavailable, and a held-out task set. Capture raw JSON/CSV, environment, dates and reproduction commands. Do not fake a rising curve; if it stays flat or regresses, show the truth and fix the mechanism.

4. **Build a judge-usable experience.** Host a live accessible judge app that lets someone run a task and inspect its context selection, graph nodes/edges, evidence, baseline comparison, and feedback loop. Verify the URL in fresh private browser mode. The existing `mimir-site-dusky.vercel.app` is a marketing landing page unless actually proven interactive; do not label a static preview a live HydraDB-backed application. Prefer a stable hosted endpoint, not a development tunnel that dies when the laptop sleeps.

5. **Technical red team.** Independently test empty task, unsupported skills, missing connection, 100–1000 available tools, many concurrent requests, disconnected node, stale edge, poisoned MCP schema, tenant isolation, privilege escalation attempts, wrong graph cell, duplicate seed idempotency, timeout and rollback. Record failures honestly. Avoid gold-plating the homepage until these gates are green.

6. **GTM (50% of judging).** Make one compelling problem/solution visual and a short case study for AI platform teams drowning in large MCP registries. ICP: platform engineering lead running local/on-prem enterprise agents. Business model: open core plus paid enterprise policy analytics/observability and managed administration — **hypothesis, not validated revenue**. Share proof-led product posts on X, LinkedIn and relevant social channels, verify and tag the authentic HydraDB handle, provide URLs, and ask actual prospective buyers a concrete integration/WTP question. Never manufacture likes, customers, paid validation, quotes or market traction. Simulated judge personas are for adversarial QA, never proof of real demand.

7. **Make the Loom.** Capture a working 90–150-second walkthrough: real OSS server/graph traversal; Mimir task choosing minimal context; actual before/after with reproducible metrics; one verified feedback edge changing later selection; live URL; source repo; target buyer. Check video playback without login; include captions. Do not use a scripted mock while saying it's real.

**Confirmed organizer event:** https://luma.com/bqwllms4 — the event page lists the event venue as Discord and registration as approval-required. Official Discord invite: https://discord.com/invite/YPtwenvxY8 . The public Luma page does NOT show a submission form, so inspect the actual server announcement/submission channel. Do not reuse the unrelated August Hack Hydra submission form.

8. **SUBMIT BEFORE THE CUTOFF.** Locate the hackathon's actual submission form or organizer channel, enter (a) live usable app URL, (b) public GitHub repo and exact branch/commit, (c) publicly playable Loom. Verify form receipt and screenshot confirmation with submitted timestamp. If login/2FA/manual permission blocks submission, send me a precise action request immediately with the link and what to click; keep building everything else. Do not claim submitted unless the platform confirms it.

## Execution policy

Use short execution checkpoints at every meaningful completed artifact: changed files, tested commands, links, real results, owners and next gate. Do not ask me to make routine engineering decisions. For actions requiring explicit user approval (public posts, accessing accounts, submitting externally), request it at the existing approval gate, never bypass it.

Prioritize **P0 real OSS graph and live judge link; P0 repo/Loom/submission; P0 real GTM post; P1 measurable feedback curve; P2 aesthetics**. With 25 minutes left, stop feature work, verify three submission artifacts, submit, and screenshot receipt. If blocked, report the exact blocker and the strongest truthfully executable fallback.

Your success criterion is not that you wrote an impressive plan. It is **an actual submission receipt timestamped before 03:30 GMT**, with verified real graph behavior and reproducible evidence. Winning cannot be guaranteed.
