# Mimir — state ledger

Updated 2026-11-13 evening. Product name is **Mimir** (not Yggdrasil). Baseline commit `ae27de5`; everything since is uncommitted.

Two agents have edited this tree today (Claude Code and Antigravity). Before editing, check `git status` and the newest file timestamps so work is not overwritten.

## Verified now

| Check | Result | Command |
|---|---|---|
| Unit + integration | 60/60 pass | `node --test tests/*.test.mjs` (needs Ollama running with `qwen3:1.7b`) |
| UI end to end | pass, 0 console errors | `node tests/e2e-ui.mjs` (after `npx vite build`) |
| Production build | pass | `npx vite build` |
| Windows installer | built and install/uninstall tested earlier today | `npm run dist:win` — **not rebuilt since later changes** |

Live checks with `qwen3:1.7b` on this machine:
- "Remember that …" in one chat, asked about in a brand-new chat → answered correctly.
- `@Mara …` → Mara answers directly (about 1–4 s).
- "… Ask @Cole for a tagline" to the chief → Cole runs, chief builds on his report (8 s), chip shows `Cole:done`.

## Product direction (owner, 2026-11-14)

**Describe your workflow once; Mimir runs the whole thing.** Free, on the computer you already own. Run receipts and claim checks stay as an internal reliability layer, not a headline feature.

## What changed in the last session

- **Workflows** (`daemon/workflows.mjs`, Routines → Workflows): one sentence → trigger + ordered steps, each step assigned to a bot by its opening verb; results handed step to step; every step's output written to disk by the engine; checkpoint after each step; resume from the failed step; schedules go through the proactive engine. Each step only gets the tools its kind of work needs (research: search/read; writing: none), and an empty result gets one forced write-up. Live with `qwen3:1.7b`: a 3-step workflow went from failing after 147 s to finishing in 8 s once tools were scoped.
  - Not built: weekday schedules, steps that branch or run in parallel, approvals shown outside the Workflows card, connectors as step targets (email/Slack send), editing a saved workflow in the UI.
  - Research steps on a tiny model still often produce general knowledge rather than fresh web findings; the step is marked with a note when it finished without tools.
- **Service worker fix**: scripts and styles were cached forever on first load, so the UI never updated. Now network-first, old cache purged, not registered on the dev server.
- **Run receipts** (`daemon/receipt.mjs`): each turn records what tools really did and flags statements like "I saved the file" with no matching action. Attached to messages; no UI yet.

- **Context across chats** (`daemon/context-recall.mjs`): a shared profile (facts the user asks to remember, given to every bot) plus recall of relevant lines from earlier chats. Recall is limited to the same bot and its team unless `crossBotRecall` is on. Only the user's own typed/spoken text can write to the profile; webhook, routine and sub-agent text cannot.
- **Delegation is real**: an `@mention` runs the specialist in its own sandbox and posts its reply under its own name. A chat message is tagged as a delegation only when a bot actually ran, with done/failed status. Before this, a "Klaus → @Mara" step was marked done even when Mara never ran.
- **Approvals from specialists** now appear in the chat the user is looking at (`rootThreadId`). Before, they waited unseen for 5 minutes and were auto-denied.
- **Reversibility policy** (`approvalPolicy: 'reversibility'`, Settings): reversible work runs alone; irreversible and unknown actions ask. Opt-in; the default (`ask-writes`) is unchanged.
- **Context window**: the app now asks Ollama for an explicit window (`ollamaNumCtx`, default 8,192), trims long chats itself (newest kept, model told what was cut) and recalls relevant lines from the cut part. Measured hardware numbers and the full design: `docs/HARDWARE_SYSTEM_DESIGN.md`.
- **Model library for any machine** (`daemon/model-library.mjs`): detects GPU/RAM (NVIDIA, Apple Silicon, or processor-only), rates 20 catalog models as fast / well / slowly / too large, recommends one, installs through Ollama with real progress, and derives routing tiers from what is installed. Live-tested here: a 0.8 GB model installed in 21 s. Other GPU brands (AMD, Intel) are treated as processor-only. Ollama itself is not installed by Mimir; a missing Ollama shows a download link and command.
- **OpenRouter sign-in** (browser OAuth, no key pasted): tested against a fake server only — **not yet run against the real openrouter.ai**. Starts on a free tool-capable model. Direct OpenAI / Anthropic / Google still need an API key; those providers offer no account login for API use.
- Model setup wizard + local-only guard, remote MCP over Streamable HTTP with OAuth sign-in, `Grok Bot` → `Mimir` rename (env vars `MIMIR_*`, legacy `GROKBOT_*` still read).

## Known problems (observed, not fixed)

- With the 1.7B model, a chief with all tools available tends to call `council_convene` and `memory_save` for simple questions. Mitigated only for turns where a teammate has reported (tools are withheld for the synthesis). The general case needs a smaller default tool set per bot role.
- `memory_save` asks for approval under the default policy, which interrupts unattended runs.
- Delegations run one after another (one local model). No parallel workers.
- Shared-profile capture is pattern-based ("remember that …", "my name is …"); it will miss facts stated other ways.
- Installer 1.0.5 (2026-11-15) matches the code. The landing page is no longer packed into it.

## Blocked on things only the owner can provide

Code-signing certificate · Google OAuth client (Gmail/Drive/Calendar sign-in) · macOS/iOS build host · an always-on machine for true 24/7 · model API keys (a chat subscription is not an API key; providers do not offer login-without-key for API use).

## Update 2026-11-20 (tool routing, first task)

- **Role-scoped tool sets already exist** (`curateToolsForBotTurn`, `daemon/local-exec.mjs`); the "Known problems" item about over-calling is partly stale. Measured with `qwen3:1.7b`, 16 plain + 16 tool prompts (`tests/tool-gate-bench.mjs`, results in `docs/tool-gate-bench.json`): today's curation over-called a tool on 1 of 16 plain prompts.
- **Context Graph router is now on by default** and works without HydraDB (`store: 'auto'` falls back to an in-process graph that forgets on restart). Same bench: first tool call correct 50% → 62.5%, overall 71.9% → 81.3%, prompt tokens 896 → 664. **Small sample (n=32, one model, one run): treat as a direction, not proof.** A "no tools unless the request shows a need" gate was tried and did not improve accuracy (not shipped). Telling the model which tools were pulled made it worse.
- The graph changes what the model is *shown*, never what it may *run* (`permittedToolNames` in `daemon/agent-runner.mjs`). Setup never blocks a turn: a slow graph is skipped once and used when ready.
- **First launch has a step two**: after the model is set up, `FirstTask` offers three starter tasks (plan my week, explain something, make a file). Shown once; covered by the e2e journey.
- Build note: `cargo build --release --manifest-path rust/Cargo.toml` is needed for the Rust WAL test to pass in a fresh checkout.

## Next, in order

1. Real users: five people run it and report what broke (owner).
2. Re-run the tool-routing bench with more prompts and a 4B model before claiming more.
3. UI density pass: fewer words per screen, one primary action per view.
4. ~~Telegram bridge for phone approvals~~ built 2026-11-20 (`daemon/telegram.mjs`, Settings card, `tests/telegram.test.mjs`). Tested only against a local stub of the Bot API; **never run against the real api.telegram.org**. Needs one real run with a BotFather token: pair, approve, deny, an irreversible approval's second tap.
