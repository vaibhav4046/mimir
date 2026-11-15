# MIMIR Omni — Deep Research Architecture & 9-Principle System Design

> **Purpose:** Engineering specification backing Mimir's autonomous multi-agent runtime, Self-RAG + CRAG + LightRAG retrieval pipeline, adaptive test-time compute harness for small local models (`qwen3:1.7b`), 3-stage anonymized Board Meeting Model Council, duplex neural/offline voice engine, and 9-principle hybrid Rust + Node + React system design.
>
> **Honesty & Grounding Rule:** Every algorithm below is grounded in peer-reviewed research or verified baseline repository measurements. Quantitative benchmark tables distinguish strictly between pre-harness baseline measurements (`docs/eval-results.json` from `2026-11-13`) and live post-integration harness runs (`npm run eval`). Small 1.7B models gain reliability on structured, verifiable tasks through harness compute, **not** magical parity with frontier cloud models on broad open-ended coding.

---

## 1. Competitive Architecture Matrix

| Platform | Signature Strength | Mimir Equivalent & Engineering Advantage |
|---|---|---|
| **Grok Bot** (`x.ai/bot`) | Proactive scheduled actions, Auto Review approvals, cloud sandbox computer | Mimir combines Rust SQLite WAL durable routines + idempotency ledger (`mimir-core`) with three selectable browser engines (`embedded`, `user-computer`, `free-cloud`), approval dialogue cards, and AES-256-GCM secret redaction (`tests/daemon.test.mjs`). |
| **Perplexity Computer** | Task-graph decomposition, live source synthesis, multi-model routing & parallel subagents | Mimir extends `dag-swarm.mjs` into topological parallel wavefronts + `RagEngine` CRAG/LightRAG source grading + 3-stage `ModelCouncilEngine` across heterogeneous seats (`qwen3:1.7b`, `4b`, `9b`, BYOK/BYOA). |
| **BridgeMind** | Fast Agent / Code / Chat workspace switching, repo-aware MCP bridge & BYOA CLIs | Mimir exposes explicit `Agent \| Code \| Chat` execution modes (`store.mjs`, `agent-runner.mjs`), Nine-Realms project topology (`RealmProjectMapView.jsx`), stdio/HTTP MCP + OAuth PKCE accounts, and sandboxed BYOA adapters. |
| **Meta Muse / Instinct** | Low-friction proactive suggestion cards, memory synthesis, zero-config start | Mimir `ProactiveEngine` (`proactive.mjs`) + 4-screen `ModelSetupWizard` + 4Q Forge wizard + episodic memory importer deliver low-friction onboarding with crash-recoverable background watches. |
| **ChatGPT Voice Mode** | Low-latency natural conversational turn-taking & barge-in interruption | Mimir pairs a persistent warm Python daemon (`voice_engine.py --mode daemon`) keeping `WhisperModel` in RAM + neural `edge_tts` / offline SAPI5 fallback + Web Audio RMS VAD + native `<dialog>` `VoiceLiveModal` with WCAG 2.2.2 pause control. |

---

## 2. Research Foundations Implemented in Mimir

### 2.1 Hybrid Retrieval & Critique: Self-RAG + CRAG + LightRAG (`daemon/rag-engine.mjs`)
1. **LightRAG — Dual-Level Graph + Chunk Retrieval** *(Guo et al., 2024, "LightRAG: Simple and Fast Retrieval-Augmented Generation")*
   - *Mechanism:* Extracts domain entities and typed relations into an incremental local graph (`<knowledgeDir>/graph.json`) alongside chunk vectors/tokens. Queries match both **low-level** specific entities/files and **high-level** thematic neighbors in one hop, supporting incremental upserts without full re-indexing.
2. **CRAG — Corrective Retrieval Evaluator & Web Fallback** *(Yan et al., 2024, "Corrective Retrieval Augmented Generation")*
   - *Mechanism:* Before trusting local snippets, a fast retrieval evaluator classifies coverage into `CORRECT`, `AMBIGUOUS`, or `INCORRECT`. On `INCORRECT` or low-confidence `AMBIGUOUS`, `RagEngine` decomposes/rewrites the query and triggers `fetchLiveSearch` (DuckDuckGo + Wikipedia, cached with TTL), discarding irrelevant filler spans before synthesis.
3. **Self-RAG — On-Demand Reflection & Support Filtering** *(Asai et al., ICLR 2024, "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection")*
   - *Mechanism:* Gates retrieval dynamically (skipping retrieval on pure math/trivial chit-chat), tags retrieved spans with `[IsRelevant]` and final claims with `[IsSupported]` grounding checks so hallucinations lacking context evidence are caught or regenerated.

### 2.2 Scaling Small Models (`qwen3:1.7b`) Without Magic Claims (`daemon/agi-harness.mjs`)
> **Baseline Reality Check (`docs/eval-results.json`):** On an `NVIDIA GeForce RTX 3050 6GB`, `qwen3:1.7b` runs at `90.0 tok/s` warm peak (`41–51 ms` warm TTFT) completely in VRAM, vs `qwen3.5:4b` at `40.0 tok/s` and `qwen3.5:9b` at `9.7 tok/s` (spillover to RAM/CPU). Raw single-shot `1.7b` drops sharply on multi-constraint planning, strict JSON repair, and multi-hop bug triage compared to 4B/9B or frontier models.

To maximize what `qwen3:1.7b` can reliably achieve **inside a local $0 harness**:
1. **Optimal Test-Time Compute Allocation** *(Snell et al., 2024, "Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameters")*
   - Route trivially simple prompts directly (`N=1` fast path).
   - For structured, multi-constraint, or coding tasks, allocate Best-of-$N$ diverse parallel drafts (temperature/role diversity: *Planner*, *Skeptic*, *Direct*) scored by deterministic **Process/Outcome Verifiers** (JSON Schema validator, regex/constraint checkers, `node --check` syntax verifier, workspace path/safety checks, and Self-RAG support check).
2. **Reflexion Episodic Self-Critique** *(Shinn et al., 2023, "Reflexion: Language Agents with Verbal Reinforcement Learning")*
   - When verification fails or a tool errors, extract a concise verbal critique stored both in short-term loop memory (bounded `maxRefine <= 2`) and cross-session RSI rules (`rsi.recordRunDatasets`), converting raw failures into improved next-attempt guidance without gradient updates.
3. **Genuine Frontier Gap (Never Hidden)**
   - On open-ended cross-repository architecture synthesis, deep semantic subtlety, and long-horizon unguided debugging, a 1.7B parameter model remains fundamentally capacity-bound; Mimir surfaces confidence scores and escalates transparently to `qwen3.5:4b`/`9b`, `ModelCouncilEngine`, or user-authorized BYOK frontier models when local verification fails.

### 2.3 Board Meeting / Anonymized Model Council Protocol (`daemon/model-council.mjs`)
Inspired by Karpathy's **`llm-council`** architecture and extended into Mimir's autonomous workspace:
- **Stage 1 — First Opinions (Bounded Parallel):** Selected council seats (configured user bots + installed local/BYOK models) answer the topic independently. Concurrency is capped (`<= 3` for local GPU seats) to prevent VRAM thrashing.
- **Stage 2 — Anonymized Peer Critique & Borda Leaderboard:** Each response is shuffled and relabeled `Response A`, `Response B`, `Response C`... Peer reviewers score accuracy, edge-case coverage, and actionability without seeing author identities (eliminating model-name and self-preference bias), yielding a consensus **Borda Count Leaderboard**.
- **Stage 3 — Chairman Synthesis & Dispatch:** The designated Chairman synthesizes the winning solution, preserves minority safety dissents, and emits structured `actionItems` dispatchable directly into Mimir Chat, Subagent Loops, or Foundry Artifacts.

### 2.4 Autonomous Bot Spawning & Bounded Subagent Loops (`daemon/local-exec.mjs`, `daemon/agent-runner.mjs`)
- **`bot_spawn` Tool:** Allows an orchestrator bot to dynamically instantiate specialized allies (`parentBotId`, `specialistTag`, isolated per-bot sandbox under `sandboxes/<botId>`), strictly bounded by **privilege non-escalation** (child allowed tools $\subseteq$ parent allowed tools) and `classifyToolApproval` gates.
- **`subagent_loop` Tool:** Delegates sub-tasks with hard **depth limit (`maxDepth = 2`)** and cycle/step caps, streaming real-time `swarm:step` progress cards into the parent thread timeline.

---

## 3. Nine Principles of System Design & Persistent Duplex Voice

1. **Reliability & Durability:** Rust `mimir-core` SQLite WAL queue with monotonic lease expiration, crash reclaim, idempotency keys, and Dead-Letter Queue (`dlq`).
2. **Scalability (Vertical & Horizontal):** VRAM-aware concurrency limiter + horizontal `--worker` lease pull (`/v1/workers/claim`) + wavefront parallel `DagSwarmEngine`.
3. **Maintainability:** Strict domain split (`rust/` security & durable state, `daemon/` orchestration/RAG/council/voice/MCP, `renderer/` React UI views).
4. **Fault Tolerance:** Per-provider circuit breakers (`CLOSED -> OPEN -> HALF_OPEN`), exponential backoff + jitter, auto-respawning persistent voice daemon.
5. **Security (Zero-Trust):** Symlink-safe canonical path sandbox, AES-256-GCM vault + secret redaction on tool/error/export paths, `[UNTRUSTED WEB CONTENT START]` prompt-injection fencing, mandatory CAPTCHA human handoff (`blocked_by_challenge`), and non-escalating `bot_spawn`.
6. **Observability:** Correlation IDs, Prometheus/JSON `/v1/metrics`, live WebSocket `council:step` & `swarm:step` timelines, preflight health diagnostics.
7. **Latency & Performance:** Persistent Python JSON-line voice daemon (`voice_engine.py --mode daemon`) eliminates per-turn `WhisperModel` reload overhead and defaults to crisp `edge_tts` neural synthesis (with instant offline SAPI5 fallback and LRU cache for repeated cues), paired with Web Audio RMS silence VAD in `VoiceLiveModal.jsx`.
8. **Extensibility:** Protocol-driven stdio/streamable-HTTP MCP Hub + OAuth PKCE + declarative JSON swarm recipes + BridgeMind `Agent / Code / Chat` modes.
9. **Cost & Resource Efficiency:** Zero-dollar local Ollama default (`qwen3:1.7b` / `4b` / `9b`), adaptive test-time compute (spending extra samples *only* when verification demands it), and hard BYOK spend caps.

---

## 4. Verification & Reproducibility Plan

- Unit & Integration Suites: `node --test tests/*.test.mjs` covering CRAG/LightRAG/Self-RAG, anonymized Stage 1–3 Model Council, `bot_spawn` privilege non-escalation & `subagent_loop` depth bounds, persistent voice daemon fallback, and Coordinator API routes.
- Rust Core Suite: `cargo test --workspace` validating SQLite WAL durability, lease reclaim, secret redaction, sandbox bounds, and 7-format artifact validators.
- Live Harness Benchmark (`npm run eval`): Direct reproducible run against local Ollama (`2026-11-13T15:00:27Z`, 8 deterministic tasks in `docs/eval-results.json`) comparing baseline (`qwen3:1.7b` `75%`, `qwen3.5:4b` `75%`, `qwen3.5:9b` `88%`) vs Harnessed Best-of-N + Reflexion (`qwen3:1.7b` `75%`, `qwen3.5:4b` `88%`, `+13%` delta) vs Local 1.7B Council (`50%`, showing Chairman formatting variance at 1.7B scale).
- Live Browser & Responsive E2E (`npm run test:e2e`): Playwright verification of Mimir app (`Boardroom`, `VoiceLiveModal`, `Agent|Code|Chat`, existing 11 views) + `public/landing/index.html` across `1440px`, `1280px`, `768px`, `390px`, `320px` with zero console/page errors and `scrollWidth - innerWidth <= 2`.
