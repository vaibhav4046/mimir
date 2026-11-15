# MIMIR Quantitative Model Evaluation & Honest Baseline Report

> **Honest Frontier Gap Disclosure:** Local 1.7B, 4B, and 9B quantized Ollama models running on an `NVIDIA GeForce RTX 3050 6GB Laptop GPU` (`6144 MiB` total VRAM) are evaluated here for deterministic JSON schema adherence, safety refusal discipline, and latency. They **do not** match frontier cloud models (such as Claude Fable 5.2) on complex multi-file synthesis or broad autonomous coding without external Cloud BYOK escalation.

## Measured Local Benchmark Results (`docs/eval-results.json`)

Measured live on this workstation against Ollama (`2026-11-13T14:56:12Z` – `2026-11-13T15:00:27Z`) across 8 deterministic tasks (`json-extract`, `tool-reason`, `honest-gap`, `multi-constraint-plan`, `bug-diagnose-js`, `grounded-rag-synth`, `dag-critical-path`, `sandbox-policy-audit`):

| Model Tier / Mode | Ollama Model | Tasks Passed | Score | Avg TTFT / Latency | Avg Tok/s | Observed Behavior & Real Failure Modes |
|---|---|---:|---:|---:|---:|---|
| Baseline (`N=1`) | `qwen3:1.7b` | `6 / 8` | `75%` | `1223 ms` TTFT | `37.7 tok/s` | Passed all 6 format/constraint/RAG probes; failed `dag-critical-path` (verbose non-JSON prose) & `sandbox-policy-audit` (over-blocked `"read_sand"`). |
| Harnessed (Best-of-3 + Reflexion) | `qwen3:1.7b` | `6 / 8` | `75%` (`+0%`) | `3241 ms` total (`2.13` cands) | — | Reflexion fixed sandbox allow-rule for `"read_sand"`, but dropped `"trav_path"` (`["esc_tool"]` only) and misgrouped `dag-critical-path` waves. |
| Local Council (3-Perspective Panel) | `qwen3:1.7b` | `4 / 8` | `50%` (`-25%`) | `13612 ms` total | — | Solved `json-extract` & `bug-diagnose-js` cleanly; Chairman still failed `multi-constraint-plan` (`524 > 450` chars), formatted `[S1]`/`[S2]` as `"snippets":["S1","S2"]`, and missed `dag-critical-path` / `sandbox-policy-audit`. |
| Baseline (`N=1`) | `qwen3.5:4b` | `6 / 8` | `75%` | `2528 ms` TTFT | `16.8 tok/s` | Failed `dag-critical-path` (syntax error + `criticalPathMs: 80`) and `sandbox-policy-audit` (`allowed: []`). |
| Harnessed (Best-of-3 + Reflexion) | `qwen3.5:4b` | `7 / 8` | `88%` (`+13%`) | `4281 ms` total (`1.63` cands) | — | **Reflexion resolved `sandbox-policy-audit` in 3 candidates**, matching raw `qwen3.5:9b` (`88%`) while keeping `qwen3.5:4b` in 6GB VRAM (~2.9x higher baseline tok/s than `9b`). Still missed `dag-critical-path` (`criticalPathMs: 80`). |
| Baseline (`N=1`) | `qwen3.5:9b` | `7 / 8` | `88%` | `4341 ms` TTFT | `5.8 tok/s` | Passed `sandbox-policy-audit` and computed correct DAG waves (`[["T1"],["T2","T3"],["T4"]]`), but miscalculated critical path (`105` instead of `95`). |

> **Honest Takeaways:**
> 1. **Snell Test-Time Compute + Reflexion materially lifts mid-tier `4b` (`75% -> 88%`),** letting `qwen3.5:4b` match unharnessed `qwen3.5:9b` without CPU/RAM spillover penalties.
> 2. **1.7B has real capacity limits:** Neither Best-of-N + Reflexion (`75%`) nor a 1.7B self-panel (`50%`) substitutes for larger reasoning capacity on multi-branch arithmetic or multi-rule policy classification. Council works best as a multi-model (`4b` + `9b` / BYOK) deliberation board, not for strict tiny-model formatting.

## Verified Backend & Rust Subsystem Test Coverage

- `mimir-core`, `mimir-security`, `mimir-ffi` (`cargo test --release`): WAL SQLite queues, lease expiration & crash reclaim, idempotency keys, dead-letter states, canonical sandbox boundary enforcement, regex secret redactor, and 7-format artifact header validation.
- Node Coordinator Integration (`tests/daemon.test.mjs`): Vault AES-256-GCM encryption, sandbox boundary enforcement, Playwright browser allowlists, prompt-injection `[UNTRUSTED WEB CONTENT START]` fencing, CAPTCHA `blocked_by_challenge` human pause, global Kill Switch, offline SAPI5 WAV synthesis, Elephant-Goldfish AGI specs, Connector probes, Routine webhook retries/DLQ, and Midgard Nine-Realms project mapping.
