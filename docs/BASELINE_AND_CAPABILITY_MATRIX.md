# MIMIR Omni — Baseline & Capability Matrix

- **Repository**: `D:\project\grok-bot-clone`
- **Baseline Git Commit**: `ae27de58a11d0ffc80aa933751fe4f039ce86d68` (`main`)
- **Date**: 2026-11-13

## 1. Host Hardware & Runtime Verification

| Component | Verified Value / Location | Status |
| :--- | :--- | :--- |
| CPU | `12th Gen Intel(R) Core(TM) i5-12450HX` (8C / 12T) | Verified |
| RAM | `15.71 GB` | Verified |
| GPU | `NVIDIA GeForce RTX 3050 6GB Laptop GPU` (`6144 MiB` VRAM, `4221 MiB` free) | Verified |
| Node / npm | Node v24 ESM + `npm 11.19.1` | Verified |
| Rust Toolchain | `rustc 1.98.1`, `cargo 1.98.1`, MSVC `14.44.35207` `link.exe`, Android targets (`aarch64-linux-android`, `x86_64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`) | Verified |
| Android SDK | `%USERPROFILE%\AppData\Local\Android\Sdk` (`platforms/android-33..36`, `build-tools/33..36`, `ndk/27.0.12077973`, `27.1.12297006`, `system-images/android-36/google_apis_playstore/x86_64`) | Verified |
| Python 3.13 | `reportlab 4.4.5`, `PyMuPDF 1.27.2.2`, `pypdf 6.9.2`, `python-docx 1.2.0`, `python-pptx 1.0.2`, `xlsxwriter 3.2.9`, `pillow 11.1.0`, `playwright 1.58.0`, `uiautomation 2.0.29` | Verified |
| Ollama (`127.0.0.1:11434`) | `qwen3:1.7b` (`1.4 GB`), `qwen3.5:4b` (`3.3 GB`), `qwen3.5:9b` (`6.6 GB`) | Verified |
| macOS Build Runner | Windows 11 host — Apple Silicon/macOS runner not present | Blocked on Windows |

## 2. Baseline Functional & Gap Audit (Pre-Upgrade)

| Domain | Existing Baseline (`ae27de58`) | Gaps & Target Architecture |
| :--- | :--- | :--- |
| **Core Backend** | Node.js ESM HTTP/WS coordinator (`daemon/coordinator.mjs`, `store.mjs`, `scale-queue.mjs`, `vault.mjs`), JSON file persistence | Add **Rust workspace** (`rust/`: `mimir-core`, `mimir-daemon`, `mimir-cli`) with SQLite WAL durable task queue, lease/heartbeat crash recovery, ChaCha20-Poly1305/AES-GCM vault + zeroize, idempotency ledger, token-bucket rate limiter, circuit breaker, bounded backpressure, canonical path sandbox, secret redactor, and Foundry validators; integrate into `coordinator.mjs` with crash-restart verification. |
| **Chat & Subagent Timeline** | `ChatView.jsx` streams tokens, `<details>` thinking trace, tool request/result cards, approval bar | Add compact **inline subagent / web-search SVG timeline rows** with real crisp vector SVGs (Web Search, Clarified Deliverable, Subagent Handoff, Connector badges, live step count + collapsible summary) matching reference pattern. |
| **Browser & Desktop Control** | `local-exec.mjs` supports `embedded`, `user-computer`, `free-cloud` modes, `browser_search`, `browser_open`, `browser_action` | Harden explicit browser state machine (`connected`, `authorized`, `acting`, `waiting_for_approval`, `blocked_by_challenge`, `failed`, `completed`), domain allowlist toggle, file upload/download ledger, CAPTCHA/MFA takeover pause, own-computer visible launch/CDP + desktop window/click/type controls gated by Runic Approval + Kill Switch. |
| **Models, Evals & RSI** | `llm-provider.mjs` + `knowledge-rsi.mjs` probe Ollama, store learned rules, export JSONL + `Modelfile` | Keep **strictly honest** benchmarks (`qwen3:1.7b` vs `qwen3.5:4b` vs `qwen3.5:9b`) — **never** claim 1.7B == Claude Fable 5.2. Add real multi-tier router (Fast Local / Balanced Vision / Frontier Cloud BYOK), budget ceilings, quantitative eval suite (`tests/eval-suite.mjs`), and gated promotion. |
| **Multi-Agent Swarm** | Individual bots + `isTeamBot`, basic `AgentRunner` single-bot loop | Add typed **Task Graph / DAG Swarm Executor** (`Supervisor -> Planner -> Executor -> Critic -> Integrator`) with bounded parallel workers, per-task workspace sandboxes, checkpoints, abort/rollback, and reusable recipes. |
| **Worldwide Plugins & MCP Hub** | `McpView.jsx` + `mcp-manager.mjs` with stdio JSON-RPC | Upgrade to **Worldwide Plugins & MCP Directory** with real vector SVG logos (`Gmail`, `Google Calendar`, `Google Drive/Docs/Sheets/Slides`, `GitHub`, `Slack`, `Notion`, `Linear`, `Postgres/SQLite`, `Remote Desktop Commander`, `Cloudflare`, `Playwright`), `Installed` strip, `Public / Personal` filter, OAuth PKCE / Token Account Connections stored in encrypted Vault, explicit Read vs Send/Mutate scopes, and live test-connection diagnostics. |
| **Library & Artifact Foundry** | Text/file writes only inside bot sandboxes (`fs_write`) | Build **Library View (`/library`)** (`Suggested`, `Favorites`, `Folders`, `Images`, `All`, search, grid/list toggle, `New` creator) backed by real multi-format **Artifact Foundry** producing validated **PDF, DOCX, PPTX, XLSX/CSV, SVG, PNG, and Zipped Code Apps** with programmatic re-open QA checks and one-click preview/download. |
| **Midgard Project & Realm Map** | Static Norse realm badges only (`Nine Realms`) | Build interactive pan/zoom **Midgard Lake-of-Nine World Tree & Project Map** (`RealmProjectMapView.jsx`) mapping user workspaces, projects, git branches/worktrees, Chronicle threads, and Nine Realms zones with keyboard navigation and click-to-open workspace/session. |
| **Multi-Platform & PWA** | Electron (`electron/main.cjs`), Vite React web bundle, `9` daemon tests, `1` Playwright E2E test (`pageErrors: 0`) | Add PWA `manifest.webmanifest` + Service Worker (static UI cache + honest offline banner), Windows Electron package (`dist/` + desktop binary), Android Companion Kotlin/Compose + Rust JNI/NDK APK in `android/`, and honest CI/workflow documentation for macOS (`blocked` on Windows host). |
