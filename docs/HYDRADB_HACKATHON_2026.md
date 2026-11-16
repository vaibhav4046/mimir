# Mimir × HydraDB — November 16, 2026 submission runbook

**Track:** 2 / Agent Context Layer
**Deadline:** 16 November 2026, 09:00 IST = 03:30 GMT (Liverpool).
**Source:** https://github.com/hydra-db/hydradb
**Event:** https://luma.com/bqwllms4
**Mimir app source:** https://github.com/vaibhav4046/mimir
**Existing marketing site:** https://mimir-site-dusky.vercel.app

## Non-negotiable truth boundary

This branch implements an **opt-in candidate integration**, not a proven
self-hosted HydraDB production deployment. A ready Vercel landing page is
**not** a live interactive app. Do not submit a claim of completed integration,
running benchmark, or customer interest without a dated reproducible artifact.

HydraDB **Cloud is not eligible as the graph database for this event**.
The public repo and local OSS daemon must be the database used in the demo.
Mimir's old Yggdrasil project map is an in-process representation, not the
HydraDB graph and cannot satisfy the build requirement alone.

## Differentiated pitch

**Mimir Context Router: the graph that gives each local AI agent only the
tools it needs.**

Ordinary agent frameworks pack a large registry of tools and definitions into
prompts. Mimir maps capabilities to tool/MCP definitions as a live HydraDB
graph, traverses only relevant edges for a task, and intersects every returned
tool with the existing permission-checked Mimir tool list. Irrelevant context
is omitted; revoked tools never become accessible through graph data.

The buyer is a company building multi-agent internal automation: productized
as a self-hosted context-control module for constrained/on-prem environments.
The immediate wedge is LLM tool-schema overhead and control. Validate this
with actual conversations and user feedback rather than claiming demand.

## Architecture and proof

- Mimir role and execution-mode gates -> available schema list.
- `HydraContextRouter.seed()` -> OSS HydraDB `Capability` and `Tool`
  nodes, `ROUTES_TO` directed graph relationships.
- `route(task)` -> OpenCypher graph traversal with bound parameters;
  returns a reduced context list. It cannot add unauthorized tools.
- `teach({ capability, toolName, relevant })` -> durable `SUPPRESSES`
  feedback edges that change future graph traversal results without editing
  application code. This is feedback-based improvement; automated continual
  learning from agent outcomes has **not** been demonstrated yet.
- On graph failure, Mimir logs `DEGRADED` and falls back to its existing
  curated tool list; this mode is **not** a valid graph-performance demo.

## Reproduce with the self-hosted engine

Install and boot https://github.com/hydra-db/hydradb using the upstream
README and USING-HYDRADB.md. The engine is a Rust service with native
GraphBLAS / libcypher-parser dependencies; it is not an npm package and
cannot be faked with a JavaScript adjacency map.

Once `/healthz`, authenticated graph writes and an id-anchored traversal
succeed, start Mimir with:

```bash
export MIMIR_HYDRA_CONTEXT=1
export MIMIR_HYDRADB_URL=http://127.0.0.1:8443
export MIMIR_HYDRADB_TOKEN=local-development-token-32-bytes
export MIMIR_HYDRADB_CELL_ID=cell-0
export MIMIR_HYDRADB_GRAPH_ID=default
export MIMIR_HYDRADB_NAMESPACE=default
npm run dev:daemon
```

**Use a secure unique token in any deployed environment. Never commit it.**
Plaintext HTTP is accepted only for loopback. Use HTTPS externally.

In a second terminal:

```bash
node --check daemon/hydradb-context.mjs
node --test tests/hydradb-context.test.mjs
node scripts/hydradb-benchmark.mjs
```

Note: the Node tests use a simulated HTTP transport and validate contracts;
they do not prove that a real HydraDB server ran. The benchmark script refuses
to run without a configured token and records live HTTP measurements in
`artifacts/hydradb/benchmark-*.json`.

## What judges must see (engineering 50%)

1. A timestamped screencast of **actual** OSS HydraDB process and health.
2. One authenticated write/then graph traversal and raw typed response.
3. Mimir run without graph vs with graph on same model/tasks/context.
4. Real tool-schema bytes, context reduction, selected-tool precision/recall,
   and p50/p95 latency (report raw queries and environment).
5. Feedback edge insertion, repeated same request, and changed tool selection.
   For an improvement curve, run enough diverse examples with trusted feedback
   and compare with the fixed baseline; never invent values.
6. Cross-user isolation, unauthorized tool injection and unavailable-DB tests.
7. An interactive publicly accessible link. Existing `mimir-site` is a
   marketing site unless the submission flow actually executes on it.

**If a hosted full backend is unavailable:** disclose honestly and expose an
interactive deterministic demonstration backed by captured genuine HydraDB
responses, while separately showing an unedited live local session. Check
event eligibility before representing a captured demo as a live hosted app.

## Go-to-market (50%)

- ICP: engineering teams with dozens/hundreds of tools and small/local models.
- Buyer: AI platform engineering lead or enterprise automation lead.
- Pain: inflated schema context, higher latency/cost, unpredictable tool choice.
- Differentiator: graph-traversal-based context discovery + locally enforceable
  permissions and inspectable context decisions.
- Pricing hypothesis **to validate**, not established demand:
  open-source core; managed enterprise observability / SSO / policies sold per
  workspace. Ask 5–10 actual target buyers whether they would pay and what
  integration budget they control. Record consented, real quotes.
- Launch posts: X and LinkedIn, tag @hydra_db or correct HydraDB account,
  show benchmark visuals and repo/video. Do not count your own test agents
  as customers, paid demand, real feedback or testimonials.

## 120-second Loom outline

0–15s: Pain: too many agent tool definitions; Mimir product/use case.
15–35s: Show OSS HydraDB running and real graph response.
35–60s: One actual workflow; graph trace lists traversed edges and tools.
60–85s: Measured fixed-baseline vs graph result and p95.
85–105s: Inject trusted corrective feedback edge; rerun; explain limitations.
105–120s: Public demo URL, source repo, persona, willingness-to-pay signal.

**Confirmed organizer event:** https://luma.com/bqwllms4 — the event page lists the event venue as Discord and registration as approval-required. Official Discord invite: https://discord.com/invite/YPtwenvxY8 . The public Luma page does NOT show a submission form, so inspect the actual server announcement/submission channel. Do not reuse the unrelated August Hack Hydra submission form.

## Submission gate

- [ ] OSS engine deployed and tested, not Cloud
- [ ] Public interaction actually works for judges
- [ ] Public repo is the branch merged to main or a clear entrypoint
- [ ] Metrics from real benchmark run, with raw data
- [ ] Real feedback after deployment, or mark as unvalidated
- [ ] Loom playable without auth
- [ ] X/LinkedIn posts actually published and linked
- [ ] All three submission links entered in the event's **actual** channel/form
- [ ] Screenshot of successful submission and timestamp before 03:30 GMT

## Scope and risk

A cosmetic landing-page refresh is lower priority than a live engine
round-trip or submission itself. No use of credentials in source, no forged
social proof, no made-up benchmark results, no simulated customer traction.
If the deadline is close, submit the strongest truthful partial product
rather than promise a winning build that is not demonstrable.
