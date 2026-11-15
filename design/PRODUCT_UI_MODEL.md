# Product UI Model — Mimir

## 1. Who Is the User?
- **Primary user**: A technical builder, developer, or power-user operator running a local-first AI workspace on Windows (`D:\project\grok-bot-clone`, Ollama `127.0.0.1:11434`, Electron + React/Vite web console) who wants custom autonomous agents that actually inspect files, run local shell tools, drive live web browsers (Embedded, User's Own Computer, or Free Cloud CDP), import context from existing AI tools (Claude, Antigravity, ChatGPT), and continuously improve via transparent dataset/prompt/model iteration without paying cloud API subscriptions.
- **Secondary mode**: Split-window / laptop operator (`1280x800`, `1440x900`) as well as narrow companion/mobile viewport (`768x1024`, `390x844`, `320x720`) alongside an IDE.

## 2. What Is the #1 Job?
Direct an agent ("Mimir" or a forged ally) to execute real multi-step desktop and live browser work—with explicit human approval gates on mutating actions, truthful tool error reporting, reliable agent switching/creation, and live 2026 web knowledge + recursive self-improvement (RSI).

## 3. What Is the #1 Proof?
- The **live Agent Chat + Action Approval Log + Realm Browser Viewport** operating side-by-side:
  1. Sending a web/workspace task shows streamed reasoning/response alongside real grounded tool execution cards (`browser_search`, `browser_open`, `browser_action` with clickable `interactiveElements`, `fs_write`, `shell_exec`).
  2. Mutating actions pause at an explicit **Runic Approval Gate** (Allow Once / Allow Always / Deny) before executing.
  3. Tool failures (`ERROR: ...`) render honestly in vermilion (`FAILED` / `DENIED`), triggering the RSI Critic reflection pass rather than falsely displaying green `EXECUTED`.
  4. The **Realm Browser Viewport** displays the live JPEG capture from the selected engine (`Embedded Chromium`, `Own Computer`, or `Free Cloud CDP`), interactive click-on-screen coordinates, direct URL/search bar, DOM element inspector chips, and sandboxed file tree.

## 4. What Must Be Visible in 5 Seconds?
1. **Identity & Runtime Health**: Mimir emblem + active agent name/model (`ollama:qwen3:1.7b` or active override) + honest live Ollama / Queue health indicator.
2. **Primary Navigation & Agent Access**: Clean sidebar (responsive slide-over drawer at `<= 900px`) separating:
   - **Agents (`Allies`)**: Dedicated **Agents** view AND clean sidebar ally switcher where clicking an ally starts or opens that ally cleanly without accidentally triggering the Rename/Configure modal or silently dropping into an unrelated thread.
   - **Chronicles (Threads)** for the active agent.
   - Primary workspace views: `Chat`, `Agents`, `Forge AI`, `RSI & Scale`, `Routines`, `MCP Box`, `Vault`, `Settings`.
3. **Hero Centerpiece**: Active Chat Conversation & Tool Stream + Composer (`Attach +` / Prompt / `Send` / `Stop` / `Teach`).
4. **Live Computer & Browser Viewport** (toggleable right dock on desktop `>= 1100px`, clean tab/sheet toggle on smaller screens so zero clipping or horizontal overflow ever happens): mode selector (`Embedded` | `Own Computer` | `Free Cloud`), URL/search bar, live clickable screenshot, interactive element list, and Workspace tree / Memory inspector.

## 5. Identified Current Defects (Evidence-Backed)
- `daemon/local-exec.mjs` (`validateUrl` line 83-91): bare keywords like `"google"` resolve to `https://google/` (`ERR_NAME_NOT_RESOLVED`), leaving browser stuck on `about:blank` while `browser_action` times out guessing ungrounded selectors like `textarea#search-box`.
- `daemon/local-exec.mjs`: missing dedicated `browser_search`, missing grounded DOM `interactiveElements` coordinates/selectors returned to the model, and missing Browser Mode switching (`embedded`, `user-computer` headed/CDP, `free-cloud` zero-payment remote WS/CDP).
- `renderer/components/ChatView.jsx`: tool card badge displays green `Executed` even when `m.content` begins with `ERROR:`.
- `renderer/App.jsx` + `renderer/components/Sidebar.jsx`: clicking a bot loads `tList[0]` implicitly and sits beside an inline edit button that clips inside narrow panes, opening the Configure/Rename modal instead of a clear Agent switcher; no dedicated `Agents` screen exists.
- `renderer/styles.css`: rigid `grid-template-columns: 274px minmax(420px, 1fr) auto` clips both sidebar and preview pane below `1120px`; uses banned `radial-gradient` dot-grid texture and heavy offset drop-shadows; `renderer/components/Icons.jsx` uses linear/radial gradients and 4-point sparkle motif (`SpotlightRuneSvg`).

## 6. Screen Map
| View | Route / Tab Key | Core Purpose |
| :--- | :--- | :--- |
| **Chat + Viewport** | `chat` | Active agent conversation, streaming tokens, tool telemetry, approval gate, and optional Realm Browser preview dock |
| **Agents Roster** | `agents` | Grid/table of forged & default allies, active task status (`waiting`/`working`), "New Session", "Resume Latest", "Configure", "Forge New", and live horizontal/vertical worker status |
| **Forge AI** | `forge` | Cross-app Memory Importer (Claude/Antigravity/ChatGPT) + 4-Question Tick-Box Follow-Up Wizard when no prior memory exists |
| **RSI & Scale** | `rsi` | Live 2026 Knowledge Search/Indexer, Self-Improvement Critic Learned Rules, SFT/DPO JSONL Dataset builder, Ollama `Modelfile` Compiler (`mimir-rsi:latest`), Model Puller, and real 9-Principle System Design metrics + horizontal Worker Node federation |
| **Routines** | `routines` | Scheduled cron tasks & recorded workflow playbacks |
| **MCP Box** | `mcp` | Local stdio / streamable HTTP MCP server connections & live tool discovery |
| **Vault** | `vault` | AES-256-GCM encrypted credential store with `[REDACTED:vault:*]` leak protection |
| **Settings** | `settings` | LLM provider/model config, Browser Engine mode (`embedded`, `user-computer`, `free-cloud`), approval policy, scaling concurrency, theme (`dark` / `light`) |
