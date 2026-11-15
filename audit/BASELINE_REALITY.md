# MIMIR Baseline Reality Audit (`audit/BASELINE_REALITY.md`)

**Generated**: 2026-11-14  
**Repository**: `D:\project\grok-bot-clone`  
**Branch**: `fix/mimir-trustworthy-golden-path`  
**Rollback Point**: `1506bdd` (`tag: recovery/pre-resurrection-baseline`)  
**Previous Snapshot Commit**: `ae27de5` (`main`)

---

## 1. Verified Machine & Service Reality

| Component | Measured State at Audit |
|---|---|
| Operating System | Windows x64 (`Win32_OperatingSystem`) |
| CPU | `12th Gen Intel(R) Core(TM) i5-12450HX` |
| Dedicated GPU | `NVIDIA GeForce RTX 3050 6GB Laptop GPU` (`6144 MiB` VRAM total, `6001 MiB` free) |
| Integrated GPU | `Intel(R) UHD Graphics` |
| System RAM | `16,478,072 KB` (~15.72 GB total), `1,708,588 KB` (~1.63 GB free under active dev load) |
| Ollama (`127.0.0.1:11434`) | Live: `qwen3:1.7b` (1.4 GB), `qwen3.5:4b` (3.3 GB), `qwen3.5:9b` (6.6 GB) |
| Coordinator (`127.0.0.1:4567`) | Live: `GET /health` -> `{"ok":true,"service":"mimir-coordinator","version":"1.0.3","provider":"ollama","ollamaModel":"qwen3:1.7b"}` |
| Frontend (`http://localhost:5173`) | Live Vite dev server; `npx vite build` succeeds cleanly in `2.26s` |
| Python 3.13 Libraries | `reportlab`, `python-docx`, `python-pptx`, `xlsxwriter`, `PIL`, `fitz` (PyMuPDF), `faster_whisper`, `edge_tts`, `numpy`, `scipy`, `imageio`, `imageio_ffmpeg` verified installed (`pyttsx3` absent; SAPI5 handled via `System.Speech.Synthesis`) |

---

## 2. Control Plane & Subsystem Inventory

- **Primary Authoritative Control Plane**: Node.js (`daemon/coordinator.mjs`, 169 HTTP route handlers) + SQLite WAL (`daemon/store.mjs`) + Rust core/security (`rust/crates/mimir-core`, `mimir-security`, `mimir-ffi`, `mimir-daemon`).
- **Frontend SPA**: React 18 (`renderer/App.jsx`) with 14 imported view/panel/player modules:
  `chat`, `overview`, `library`, `map`, `agents`, `forge`, `council`, `rsi`, `mcp`, `vault`, `routines`, `settings`, `mimri`, plus modals (`VoiceLiveModal`, `BotManagerModal`, `ComputerPane`, `CreativeStudioPlayer`, `HairlineCanvas`).
- **Python Workers (`scripts/`)**: `foundry_builder.py`, `creative_studio_builder.py`, `voice_engine.py`, `desktop_ctrl.py`.
- **Duplicate/Secondary Subsystem (`mimri/`)**: Python FastAPI/PostgreSQL/Docker/LiveKit scaffold (`mimri/services/core/app.py`, `harness.py`, `router.py`, `telemetry.py`, `services/workers/*`, `packages/memory/store.py`, `packages/sandbox/*`). Runs offline/mock-safe via Node `daemon/mimri-platform.mjs` bridge and must be explicitly subordinated to isolated worker execution rather than acting as a competing control plane.

---

## 3. Baseline Verification & Issues Found

- **Baseline Test Suite**: `npm test` passes **73 / 73** tests across 13 suites (`83.9s`), and `npm run test:e2e` passes with `0` page errors and `0` console errors.
- **Concrete Architectural & Product Gaps Identified**:
  1. **Contract & Lifecycle Sprawl**: Entities (`Task`, `Run`, `Step`, `ToolCall`, `ToolResult`, `Approval`, `ModelInvocation`, `WorkerJob`, `Artifact`, `EvidenceReceipt`, `MemoryNode`, `ConnectorSession`, `VoiceTurn`, `MediaRender`) are spread across modules without a single versioned schema registry (`daemon/contracts.mjs`) or unified 7-state lifecycle validator.
  2. **UI Navigation Sprawl**: 13 top-level destinations appear without progressive disclosure into Core 6 destinations vs Advanced Tools, and `ChatView.jsx` lacks unified Project/Connection/Mode Override composer controls and plain-English step status mapping.
  3. **Self-Graded Score Text**: `daemon/agent-runner.mjs` (`buildDreamLoopReport`) emits hardcoded `score: 9.4` rather than real structural pass counts (`checksPassed / totalChecks`).
  4. **Missing Audio/Music Pipeline**: `daemon/foundry.mjs` and `scripts/creative_studio_builder.py` support 9 document formats + SVG/PNG/MP4/WebM/3D/WebApp, but lack real multi-track Music & Audio (`.wav` / `music`) synthesis, waveform player UI, and acoustic QA verification.
  5. **WebApp Depth & Video Hardware Honesty**: `build_webapp` produces single-HTML apps rather than multi-file expense-tracker project bundles (auth + SVG charts + CSV/JSON export + runnable tests), and video generation does not clearly distinguish Tier 1 deterministic composition from hardware-gated Tier 2 generative diffusion (`6 GB` VRAM RTX 3050 limit).
  6. **Voice Backchannel & Barge-In Filtering**: Short conversational backchannels (`"mm-hmm"`, `"uh-huh"`, `"yeah"`) are not separated from true user barge-in commands (`"stop"`, multi-word interruptions).
  7. **Yggdrasil Atlas Completeness**: `daemon/project-map.mjs` covers subset of entities rather than all 11 required node types (`project`, `file`, `task`, `conversation`, `bot`, `memory`, `source`, `decision`, `skill`, `artifact`, `timeline`) with duplicate/stale diagnostics.
  8. **Model Council Default Policy**: Council orchestration needs explicit opt-in default metadata (`councilEnabledByDefault: false`) unless user-invoked or benchmark-proven superior.

---

## 4. Target Resurrection Outcome

Consolidate onto **Node + Rust + SQLite WAL** as the single control plane, expose all 14 versioned entity contracts + hardware capability telemetry, simplify UX to **6 Core Destinations + Advanced Tools drawer** with **"What would you like to get done?"** + **Adaptive Workspace**, add verified Music `.wav` synthesis, multi-file Expense-Tracker WebApp generation, Tier 1/2 video honesty, voice backchannel filtering, 11-node Yggdrasil atlas, and ship all 15 audit/engineering deliverables verified by automated + live Chromium tests.
