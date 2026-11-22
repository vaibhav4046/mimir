# Mimir OS Benchmark Results

**Branch**: `fix/mimir-trustworthy-golden-path`  
**Measured At**: `2026-11-14T14:33:40.491Z` (`npm run eval`)  
**Installed Local Ollama Models Tested**: `qwen3.5:9b`, `qwen3.5:4b`, `qwen3:1.7b`

---

## 1. Local Model Eval Suite (`npm run eval` -> `tests/eval-suite.mjs`)

Deterministic 8-task benchmark (`json-extract`, `tool-reason`, `honest-gap`, `multi-constraint-plan`, `bug-diagnose-js`, `grounded-rag-synth`, `dag-critical-path`, `sandbox-policy-audit`) run directly against live Ollama responses.

### Summary Comparison Table

| Model | Mode | Passed / Total | Score % | Delta vs Baseline | Avg Latency / TTFT | Avg Throughput / Candidates |
|---|---|---:|---:|---:|---|---|
| `qwen3:1.7b` | `baseline` | 6 / 8 | 75% | — | `avgTtftMs: 202` | `avgTokPerSec: 62.7` |
| `qwen3:1.7b` | `harnessed` | 7 / 8 | **88%** | **+13 pts** | `avgTotalMs: 2291` | `avgCandidatesTried: 2.13` |
| `qwen3:1.7b` | `council` (3 seats) | 4 / 8 | 50% | -25 pts | `avgTotalMs: 9728` | `seatCount: 3` |
| `qwen3.5:4b` | `baseline` | 4 / 8 | 50% | — | `avgTtftMs: 9962` | `avgTokPerSec: 23.3` |
| `qwen3.5:4b` | `harnessed` | 7 / 8 | **88%** | **+38 pts** | `avgTotalMs: 3242` | `avgCandidatesTried: 1.63` |
| `qwen3.5:9b` | `baseline` | 5 / 8 | 63% | — | `avgTtftMs: 4267` | `avgTokPerSec: 7.5` |

> Harnessed mode (`Adaptive Test-Time Compute + Reflexion`) lifted `qwen3:1.7b` from 75% to 88% (+13 pts) and `qwen3.5:4b` from 50% to 88% (+38 pts). Multi-seat `council` on `qwen3:1.7b` scored lower (50%) at 9.73s average latency due to strict JSON/citation formatting loss during chairman synthesis — validating `councilEnabledByDefault: false`.

### Per-Task Failure Analysis (Exact Observed Failures)

| Mode | Model | Failed Task(s) | Exact Observed Failure Reason |
|---|---|---|---|
| `baseline` | `qwen3:1.7b` | `dag-critical-path`, `sandbox-policy-audit` | Invalid JSON output; Expected `allowed=["read_sand"]`, got `[]` |
| `baseline` | `qwen3.5:4b` | `json-extract`, `bug-diagnose-js`, `dag-critical-path`, `sandbox-policy-audit` | 45013ms timeout on `json-extract`; truncated JSON string; malformed JSON array; Expected `allowed=["read_sand"]`, got `[]` |
| `baseline` | `qwen3.5:9b` | `multi-constraint-plan`, `dag-critical-path`, `sandbox-policy-audit` | Missing `VERIFY`; `criticalPathMs=105` instead of `95`; `allowed=[]` |
| `harnessed` | `qwen3:1.7b` | `dag-critical-path` | After 5 candidates: expected `criticalPathMs=95`, got `100` |
| `harnessed` | `qwen3.5:4b` | `dag-critical-path` | After 3 candidates: malformed JSON missing closing `]` (`Expected ',' or ']' after array element in JSON at position 52`) |
| `council` | `qwen3:1.7b` | `multi-constraint-plan`, `grounded-rag-synth`, `dag-critical-path`, `sandbox-policy-audit` | Chairman returned JSON prose instead of 3 numbered lines; cited `["S1","S2"]` without `[S1]`/`[S2]`; `criticalPathMs=105` & 4 waves; `allowed=[]` |

---

## 2. Application & Build Timings (Measured Runs)

| Check | Command | Measured Result | Duration / Size |
|---|---|---|---|
| Frontend production build | `npx vite build` | 58 modules transformed, 0 errors | `1.53s` (`index.html` 2.21 kB, CSS 66.16 kB, `vendor-react` 223.08 kB, `index` 393.32 kB) |
| Rust workspace suite | `cargo test --workspace --manifest-path rust/Cargo.toml` | 12 passed, 0 failed (`mimir-core`: 1, `mimir-ffi`: 1, `mimir-security`: 10) | Compile `0.58s` + test `1.44s` |
| Node full test suite | `npm test` (14 files) | **81 passed, 0 failed, 0 skipped** | `69608.04ms` (`69.6s`) |
| End-to-end Playwright UI | `npm run test:e2e` | `{"ok":true,"e2e":"passed","pageErrors":0,"consoleErrors":0}` | Exit code `0` |

---

## 3. Honest Boundaries

- Local `1.7B` / `4B` / `9B` Ollama models do not match frontier cloud models on multi-hop quantitative DAG scheduling (`dag-critical-path` failed across all modes).
- `qwen3.5:4b` and `qwen3.5:9b` had cold-start TTFT spikes (`32s–45s`) when loaded sequentially under 6 GB GPU VRAM.
