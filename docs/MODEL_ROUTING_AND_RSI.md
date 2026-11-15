# Model Routing, Elephant-Goldfish Harness, Voice, & RSI Scaling

## 1. Hardware-Aware Tier Router (`daemon/agi-harness.mjs`)

| Tier ID | Provider | Model | Est. VRAM | Cost / 1k Tok | Intended Workload |
|---|---|---|---:|---:|---|
| `fast_local` | `ollama` | `qwen3:1.7b` | `~1600 MiB` | `$0.000` | Instant classification, triage, spoken Mimir summary formatting |
| `balanced_local` | `ollama` | `qwen3.5:4b` | `~3600 MiB` | `$0.000` | Default daily work, structured tool arguments, local chat |
| `heavy_local` | `ollama` | `qwen3.5:9b` | `~6600 MiB` | `$0.000` | Multi-step local synthesis (accepts slower `~5-10 tok/s` spillover on 6 GB GPU) |
| `cloud_byok` | `openai-compat` | User-configured | `0 MiB` | `$0.006` (est.) | Optional Cloud BYOK escalation when user configures API key & budget permits |

Monthly cloud spending is tracked against `budget-ledger.json` before invoking paid BYOK routes.

## 2. Elephant-Goldfish Model (EGM) & Slash Commands

- `/elephant <goal>`: Long-horizon Architect pass. Reads repository context, Chronicles, and Knowledge memory to emit an explicit specification (`docs/specs/*`) **without** mutating source files blindly.
- `/goldfish <spec-or-topic>`: Stateless zero-context adversarial critic. Inspects the proposal fresh to expose missing validation, race conditions, security boundaries, or unverified claims.
- `/swarm <goal>`: Executes `dag-swarm.mjs` recipes (`Supervisor -> Planner -> Executor -> Goldfish Critic -> Integrator`) and streams inline timeline steps over WebSocket (`swarm:step`).
- `/voice <phrase>`: Synthesizes offline Windows SAPI5 audio (`Microsoft David Desktop`, `Microsoft Zira Desktop`) or neural `edge-tts` (`en-GB-RyanNeural`), plus local `faster-whisper 1.2.1` STT (`scripts/voice_engine.py`).
- `/eval`, `/forge`, `/library`, `/map`, `/kill`: Direct operational commands backed by `/v1/agi/eval`, `/v1/library/create`, `/v1/projects/map`, and `/v1/kill-switch`.

## 3. Honest RSI & 9-Principle Scaling Posture

- Recursive Self-Improvement (`daemon/rsi.mjs`) reflects on past execution trajectories, curates SFT/DPO training datasets locally, and feeds verified lessons back into Knowledge memory and prompt grounding — it does **not** falsely claim unsupervised weight gradient updates inside the web daemon.
- Vertical scaling uses Rust WAL SQLite connection tuning, leased worker heartbeats, and parallel DAG stages; horizontal multi-worker scaling uses standalone `mimir-daemon --worker` processes claiming durable leased jobs from the shared SQLite ledger.
