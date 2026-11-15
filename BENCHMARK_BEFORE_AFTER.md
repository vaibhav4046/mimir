# Mimir Benchmark: Before vs. After Resurrection

**Branch**: `fix/mimir-trustworthy-golden-path`  
**Baseline Commit**: `1506bdd` (`tag: recovery/pre-resurrection-baseline`)  
**Machine**: Windows x64, `12th Gen Intel(R) Core(TM) i5-12450HX` (12 cores), `NVIDIA GeForce RTX 3050 6GB Laptop GPU` (`6144 MiB` VRAM total), `16,478,072 KB` RAM, Ollama (`qwen3:1.7b`, `qwen3.5:4b`, `qwen3.5:9b`).

---

## 1. Test, Build & Runtime Comparison

| Metric | Before (`1506bdd` Baseline Audit) | After (Resurrection Head) | Verification Source |
|---|---|---|---|
| Node automated test suite (`npm test`) | **73 / 73 pass** (`83.9s`) across 13 suites | **74 / 74 pass** (`75897.5ms` / `75.9s`, `0` fail) including full `MIMIR RESURRECTION` end-to-end suite | Direct `npm test` run |
| `MIMIR RESURRECTION` integration suite | Did not exist (`0` tests) | **1 / 1 pass** (`3891.8ms` in `npm test`, `4408.6ms` solo) testing 14 contracts, hardware gating, WAV audio, Expense WebApp, voice backchannel & 11-type atlas | `tests/trustworthy-golden-path.test.mjs` |
| Rust workspace tests (`cargo test --workspace`) | Existing security/ledger suite (`mimir-security` lacked WAV validator) | **12 / 12 pass** (`mimir-core`: 1, `mimir-ffi`: 1, `mimir-security`: 10, `0` fail) + rebuilt `mimir-daemon.exe` in `23.64s` | `cargo test --workspace` |
| Vite production bundle (`npx vite build`) | `2.26s` | `2.96s` (`56 modules`, `dist/renderer/index.html` 2.21 kB, CSS 62.04 kB, React vendor 223.08 kB, app bundle 365.75 kB) | `npx vite build` |
| Playwright E2E UI test (`npm run test:e2e`) | Passed (`0` errors) | Passed (`{"ok":true,"e2e":"passed","pageErrors":0,"consoleErrors":0}`) | `npm run test:e2e` |
| Live Chromium verification (`:5173` -> `:4567`) | 13 flat sidebar destinations; fake `9.4/10` critic score; no WAV studio | **0 console errors, 0 page errors, 0 HTTP >= 400 errors** across 50/50 requests; live `qwen3:1.7b` WAV synthesis (`1,058,444` bytes) verified | Host `BROWSER_HOST_FACTS` & inspected PNGs |

---

## 2. Capability & Trustworthiness Comparison

| Area | Before Resurrection | After Resurrection |
|---|---|---|
| **Control plane authority** | Competing Python `mimri/` FastAPI surface alongside Node + Rust + SQLite WAL without explicit contract boundary | Explicit single authority: `node-rust-sqlite-wal` primary; `mimri/` subordinated to `subordinate-worker-only` (`/v1/mimri/status`) |
| **Contracts & lifecycle states** | Ad-hoc JSON payloads spread across routes | `daemon/contracts.mjs` (`SCHEMA_VERSION: "2026.1"`): **14** versioned schemas, **7** lifecycle states (`PENDING..CANCELLED`), `GET /v1/contracts`, `POST /v1/contracts/validate` |
| **Hardware & Tier-2 video honesty** | WMI 32-bit `AdapterRAM` cap masked true 6 GB VRAM; no Tier-2 diffusion gate | `nvidia-smi` live read (`6144 MiB` total VRAM, `4177 MiB` free under load); `videoProductionTier1: READY`, `videoGenerativeTier2: HARDWARE_GATED_VRAM_LIMIT` |
| **Critic verification scoring** | Hardcoded `score: 9.4` display string in `buildDreamLoopReport` | Removed fake `9.4/10` score (`score: undefined`); reports factual `checksPassed` / `totalChecks` (`Critic · VERIFIED 3/3 structural checks passed · 2 passes`) |
| **Model Council policy** | Ambiguous invocation defaults | Explicit `councilEnabledByDefault: false` on `/v1/council/seats` and `/v1/contracts` |
| **Music & Audio (`.wav`)** | No `.wav` synthesizer, no waveform UI player, no Rust WAV header validator | 44.1 kHz stereo PCM `.wav` synthesizer (`scripts/creative_studio_builder.py`), interactive `<canvas>` waveform + `<audio>` player, Rust `validate_wav` checking `RIFF`/`WAVE` headers |
| **WebApp synthesis depth** | Single-HTML minimal templates | Multi-file Expense-Tracking WebApp (`>= 9` files including `index.html`, `app.js`, `src/auth.js`, `src/charts.js`, `tests/app.test.mjs`, `server.py`, `Dockerfile`, `manifest.json`, `README.md`) |
| **Voice turn evaluation** | No separation of filler backchannels vs real interruptions | `evaluateVoiceTurn` (`POST /v1/voice/turn-evaluate`): filters `"mm-hmm"` (`isBackchannel: true`, `bargeInTriggered: false`) vs `"Stop and change the plan"` (`bargeInTriggered: true`, `ttsCancelled: true`) |
| **Yggdrasil Knowledge Atlas** | Subset of node types without hygiene summary | All **11** entity types (`Project`, `File`, `Task`, `Conversation`, `Bot`, `Memory`, `Source`, `Decision`, `Skill`, `Artifact`, `Timeline event`) + clickable breadcrumbs + live diagnostics (`129 nodes · 79 edges · 32 duplicates · 0 stale · 0 conflicts`) |

---

## 3. Explicit Non-Claims & Boundaries

- **Electron Windows Installer (`npm run dist:win`)** and **Vercel public site deployment** were not executed in this run and are reported as pending final release packaging.
- **Tier-2 generative video diffusion** remains intentionally gated on this 6 GB VRAM GPU (`HARDWARE_GATED_VRAM_LIMIT`); deterministic Tier-1 PIL/Canvas/FFmpeg composition handles local video rendering cleanly.
