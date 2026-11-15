# Mimir

**A local-first desktop AI workspace for multi-agent work, live browser control, code/document authoring, and gated execution.**

Mimir runs locally on your machine with [Ollama](https://ollama.com) (plus optional OpenAI-compatible or OpenRouter endpoints). Assistants collaborate in threads and Spaces, inspect and edit files in an interactive Canvas, drive an observable browser window, search local and live sources, generate multi-format deliverables, and pause for human approval before taking external or irreversible actions.

---

## Architecture

Mimir separates the desktop shell, the local HTTP/WebSocket coordinator daemon, and the React renderer:

```text
+-------------------------------------------------------------------+
| Electron Desktop Shell (electron/main.cjs, preload.cjs)           |
+---------------------------------+---------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| React 19 + Vite UI (renderer/)                                    |
|  - ChatView & CommandPaletteModal (Ctrl+K, branching, Spaces)     |
|  - ComputerPane & CanvasPane (Live Screen, Canvas, Files, Memory) |
|  - Overview, Boardroom, Forge, Library, Vault, Routines, Settings |
+---------------------------------+---------------------------------+
                                  | HTTP + WebSocket (127.0.0.1)
                                  v
+-------------------------------------------------------------------+
| Local Coordinator Daemon (daemon/coordinator.mjs)                 |
|  - Agent orchestration: agent-runner.mjs, dag-swarm.mjs,          |
|    model-council.mjs, proactive.mjs, routines.mjs, workflows.mjs  |
|  - Execution & safety: local-exec.mjs (Playwright), sentinel.mjs, |
|    receipt.mjs, vault.mjs, browser-guard.mjs, desktop-control.mjs |
|  - Knowledge & synthesis: rag-engine.mjs, deep-research.mjs,      |
|    knowledge-rsi.mjs, foundry.mjs, voice.mjs, llm-provider.mjs    |
+---------------------------------+---------------------------------+
                                  | Optional Python / Rust workers
                                  v
+-------------------------------------------------------------------+
| Local Workers & Storage                                           |
|  - scripts/ (voice_engine.py, foundry_builder.py,                 |
|    creative_studio_builder.py, desktop_ctrl.py)                   |
|  - Ollama / BYOK LLM endpoints + per-bot /workspace directories   |
+-------------------------------------------------------------------+
```

---

## Core Capabilities

### 1. Live Canvas & Workspace Workbench
Open code, HTML, SVG, or Markdown files from chat code blocks (`Open in Canvas`), generated artifacts, or the workspace File Tree:
- **Edit & Save**: Edit directly inside `CanvasPane` and save changes back to the assistant workspace (`PUT /v1/workspace/:botId/file`).
- **Inline AI Revisions**: Enter an instruction in `"Ask Mimir to revise"` (`POST /v1/canvas/edit`), inspect the proposed update banner, and click **Apply** or **Undo**.
- **Sandboxed Live Preview**: Switch between `Code` and `Preview` to render HTML, SVG, or Markdown inside a sandboxed `<iframe sandbox="allow-scripts">` without leaving the workspace.

### 2. Browser & Computer Control
Drive an observable browser inside the **Work View -> Screen** tab (`daemon/local-exec.mjs` via Playwright):
- **Navigation & Inspection**: Address bar, Back/Forward/Reload controls (`POST /v1/computer/:botId/action`), screenshot enlargement, and a **Show element targets** overlay showing detected clickable elements.
- **Take Control Mode**: Toggle Take Control to click, drag, scroll, and send keyboard events directly into the focused browser viewport, or pause safely for manual 2FA/login handoff.
- **Runs Ledger & Memory**: Review autonomous runs (`approve` / `deny` / `cancel`), inspect persistent workspace layout and skill files, and search or edit assistant memories (`PATCH /v1/bots/:botId/memories/:key`) with scope and provenance metadata.

### 3. Multi-Agent Swarm & Boardroom
- **Team Topology**: Deploy a 6-assistant team (Chief of Staff plus domain specialists for research, copy, design, ops, and finance) with shared channels and `@mention` delegation (`dag-swarm.mjs`, `norse-agents.mjs`).
- **Model Council Boardroom**: Run prompts across multiple models in parallel, rank outputs blindly, and synthesize a consensus response (`model-council.mjs`).
- **Spaces & Branching**: Organize threads by Space with scoped instructions, switch the active assistant mid-thread, fork conversations, or edit an earlier prompt to branch cleanly.

### 4. Offline & Live Deep Research
- Switch explicitly between **Auto**, **Live Web**, and **Offline Corpus** modes from the chat composer.
- Ground answers against local workspace knowledge (`rag-engine.mjs`, `knowledge-rsi.mjs`) or live search (`deep-research.mjs`), displaying step-by-step progress and clearly distinguishing offline corpus results from live web citations.

### 5. Live Voice
- Hands-free voice modal (`VoiceLiveModal`) with turn-taking phases (`Standby`, `Listening`, `Thinking`, `Speaking`), drag-and-drop file staging, toggleable live transcript, and keyboard/text fallback whenever microphone capture or the local daemon is unavailable.

### 6. Sentinel Approvals, Vault & Receipts
- **Reversibility Gating**: Local reads, drafts, and workspace file operations run directly, while outbound actions, system commands, and credential access route through Sentinel approval gates (`sentinel.mjs`).
- **Receipts & Kill Switch**: Actions emit auditable receipts (`receipt.mjs`), credentials stay in the local vault (`vault.mjs`), and a global kill switch halts active runs.

### 7. Multi-Format Library & Forge
- Generate and preview documents, spreadsheets, slides, SVG illustrations, and media via `foundry.mjs` (`scripts/foundry_builder.py`, `scripts/creative_studio_builder.py`), and onboard new specialized assistants in **Forge** by importing notes or answering a 4-step setup guide.

---

## Requirements

- **Node.js** (ESM support for `daemon/` and Vite 6 / React 19 renderer)
- **[Ollama](https://ollama.com/download)** for local inference (8 GB RAM minimum recommended; GPU with 4 GB+ VRAM improves speed)
- **Windows 10/11 x64** is the primary tested desktop target (`npm run dist:win`); macOS and Linux can run from source
- **Optional Python 3.11+** for local voice (`scripts/voice_engine.py`) and document/creative generation:
  ```bash
  python -m pip install -r scripts/requirements.txt
  ```

---

## Quickstart

Clone the repository and install JavaScript dependencies:

```bash
npm install
```

Run the local coordinator daemon and the Vite development UI in two terminals:

```bash
# Terminal 1: start the local coordinator daemon on 127.0.0.1
npm run dev:daemon

# Terminal 2: start the React renderer dev server
npm run dev:renderer
```

Or launch the Electron desktop shell directly (after building the renderer if needed):

```bash
npm run build
npm start
```

### Packaging (Windows x64)

```bash
npm run dist:win
```

---

## Running Tests

Run the Node unit and integration suite (`package.json`):

```bash
npm test
```

Run the end-to-end UI suite (`tests/e2e-ui.mjs`):

```bash
npm run test:e2e
```

Run the evaluation suite (`tests/eval-suite.mjs`):

```bash
npm run eval
```

---

## Honest Limits

- **Local machine uptime**: Scheduled routines and background runs execute while your computer is awake and the daemon is running; missed schedules catch up on wake.
- **Small local models**: 1B to 4B parameter local models run quickly offline, but multi-step coding, complex tool calling, and deep synthesis benefit from larger local models (7B+) or a configured external provider key.
- **Optional Python extras**: Voice synthesis/transcription and binary Office/PDF generation depend on the packages in `scripts/requirements.txt`; text, code, Canvas, chat, and browser features work without Python.
- **Unsigned desktop installer**: Packaged Windows builds from `electron-builder` are unsigned unless you provide your own code-signing certificate.

---

## License

MIT. See [LICENSE](LICENSE).
