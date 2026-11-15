# MIMIR Omni — System Architecture & 9 Principles of System Design

## 1. Hybrid Control-Plane Topology

```text
+-----------------------------------------------------------------------+
|  CLIENT SURFACES (Strict Separation of Duties)                        |
|  - Electron Desktop Shell (contextIsolation: true, sandbox: true)     |
|  - Web / Installable PWA (Strict CSP, Service Worker static cache)    |
|  - Android Companion App (Kotlin + Jetpack Compose + Rust core/HTTP)  |
+-----------------------------------+-----------------------------------+
                                    | HTTPS/HTTP + WebSocket + Auth Token
                                    v
+-----------------------------------------------------------------------+
|  RUST CORE ENGINE (`rust/crates/mimir-core` & `mimir-daemon`)         |
|  - Durable Task Queue & Lease Ledger (SQLite WAL, crash-recoverable)  |
|  - Cryptographic Vault (ChaCha20-Poly1305 AEAD, Argon2id/scrypt, Zeroize)|
|  - Idempotency Store & Dead-Letter Queue (DLQ + exponential backoff)  |
|  - 9-Principle Guardrails: Token-Bucket Limiter, Circuit Breaker,     |
|    Backpressure Queue Caps, Canonical Symlink-Safe Path Sandbox,      |
|    Secret Redactor, Structured JSON Telemetry + `/health` & `/metrics`|
|  - Artifact Foundry Validators (ZIP/OOXML/PDF/PNG/SVG verification)   |
+-----------------------------------+-----------------------------------+
                                    | Local IPC / HTTP Sidecar / FFI
                                    v
+-----------------------------------------------------------------------+
|  EXECUTION & AI ADAPTERS (Node.js ESM + Playwright + Ollama + Python) |
|  - Browser Engine (`embedded` | `user-computer` | `free-cloud` CDP)   |
|  - DAG Swarm Engine (`Supervisor -> Planner -> Executor -> Critic`)   |
|  - Multi-Tier Model Router (`qwen3:1.7b`, `qwen3.5:4b`, `qwen3.5:9b`, |
|    OpenAI-compatible / Anthropic / Google BYOK with budget guard)     |
|  - Worldwide Plugins & MCP Hub (stdio/HTTP MCP + OAuth PKCE Accounts) |
|  - Python Foundry Workers (PDF/DOCX/PPTX/XLSX/PNG real file builders) |
+-----------------------------------------------------------------------+
```

## 2. How Each of the 9 System Design Principles Is Enforced

1. **Reliability & Durability**: Tasks, DAG steps, approvals, and scheduled routines persist to Rust-backed **SQLite WAL** (`mimir-core`) with lease timestamps and worker heartbeats. If the daemon crashes or restarts mid-run, expired leases are reclaimed and idempotency keys prevent double execution of side-effecting steps (`send`, `publish`, `shell_exec`).
2. **Scalability (Vertical & Horizontal)**:
   - *Vertical*: Bounded async tokio/worker concurrency tuned to host CPU/VRAM (`RTX 3050 6GB` allows one heavy 9B model or light 1.7B/4B + concurrent Playwright/IO tasks without OOM).
   - *Horizontal*: `mimir-daemon` supports multiple stateless worker nodes (`--worker` mode / `/v1/workers/register` & lease pull `/v1/workers/claim`) claiming jobs from the durable queue.
3. **Maintainability & Clean Boundaries**: Strict modular split:
   - `rust/`: security primitives, crypto vault, durable ledger, path sandbox, redactor, validator, queue/worker binary.
   - `daemon/`: thin HTTP/WS gateway, Playwright browser adapter, Ollama/cloud router, MCP/OAuth bridges.
   - `renderer/`: accessible React components split cleanly by domain view (`Chat`, `Agents`, `Map`, `Library`, `Forge`, `Plugins/MCP`, `RSI & Scale`, `Routines`, `Vault`, `Settings`).
4. **Fault Tolerance & Resilience**:
   - Per-provider **Circuit Breaker** (`CLOSED` -> `OPEN` -> `HALF_OPEN`) prevents retry storms when an external endpoint or MCP server fails.
   - **Retry with Exponential Backoff + Jitter** and automatic **Dead-Letter Queue (DLQ)** inspection/requeue in `Routines`.
5. **Security (Zero-Trust Defense in Depth)**:
   - See `docs/THREAT_MODEL.md`. Local origin checks, bearer auth token (`X-Mimir-Token`; legacy `X-GrokBot-Token` still accepted), CSP without `unsafe-eval`, canonical symlink-safe filesystem sandboxing (`rust/mimir-core::sandbox`), AEAD vault encryption, automatic secret scrubbing on all tool/error outputs and exports, and explicit human approval gates before mutating actions.
6. **Observability**: Structured JSON event logs, Prometheus/JSON metrics (`/v1/metrics`), live DAG step timelines in Chat, hardware VRAM telemetry, and per-run correlation IDs across Node & Rust.
7. **Latency & Performance**:
   - Critical-path separation: instant token streaming + `qwen3:1.7b` reflex classification vs explicit escalation to `qwen3.5:4b`/`9b` for reasoning/vision/coding.
   - TTL LRU cache for repeated searches; Vite code-splitting + CSS `contain: layout style paint` for responsive UI (<100ms view switches).
8. **Extensibility**: Protocol-driven Plugin & MCP catalog (`stdio` + streamable HTTP + OAuth accounts) and declarative workflow recipes stored as versioned JSON DAGs.
9. **Cost & Resource Efficiency**: Default local Ollama inference (\$0 token billing), strict per-run & daily cloud spend ceiling when optional BYOK keys are configured, and VRAM-aware model unloading/tiering.

## 3. Data Directory Layout

Inside `dataDir` (`MIMIR_DATA_DIR`, else `%USERPROFILE%\.mimir`; an existing `%USERPROFILE%\.grokbot-clone` from before the rename keeps being used):
- `mimir.db` (+ `-wal` / `-shm`): Rust SQLite WAL database for durable task leases, idempotency ledger, DAG runs, and Library metadata.
- `vault.enc`: AEAD-encrypted secrets & OAuth tokens.
- `sandboxes/<botId>/`: Canonicalized per-agent workspaces.
- `foundry/<artifactId>/`: Generated PDF/DOCX/PPTX/XLSX/SVG/PNG/ZIP Library artifacts with manifest checksums.
- `knowledge/`: 2026 web/doc RAG index & verified RSI datasets (`dataset.sft.jsonl`, `dataset.dpo.jsonl`, `eval-history.json`).
