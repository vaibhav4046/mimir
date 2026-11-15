# Mimir baseline and Grok Bot parity matrix

Date: 2026-11-13. Repo baseline commit: `ae27de5` (the only commit; all later work is uncommitted).

Benchmark source: the public product page https://x.ai/bot, read 2026-11-13. It is a marketing page, not API documentation; claims below are what it states, not what was tested.

## Status scale

`Not started → In progress → Locally tested → Integration tested → Release verified`

- **Locally tested**: an automated test in `tests/` exercises the real code path and passes.
- **Integration tested**: exercised end to end through the running coordinator + UI (Playwright e2e, live preview, or packaged-app smoke test) this session.
- **Release verified**: works from the installed Windows build. Only the items marked so were checked from an install.
- A UI screen alone never counts.

Test evidence (this session): `node --test tests/daemon.test.mjs tests/proactive.test.mjs tests/commands.test.mjs` → 23/23 pass; `npm run test:e2e` → passed, `pageErrors: 0, consoleErrors: 0`; packaged `Mimir.exe` smoke and silent install/uninstall → passed (see `docs/WINDOWS_RELEASE.md`).

## Agent execution

| Capability | Grok Bot claims | Mimir status | Evidence / gap |
|---|---|---|---|
| Multi-step tool use | yes | Integration tested | Live Ollama tool turn test; e2e writes a real file in the bot sandbox |
| Browser automation | own computer runs apps and sites | Locally tested | Playwright navigate + screenshot test; allowlist + injection fence test. Click/type/upload flows not covered by a test |
| Filesystem + terminal | yes | Locally tested | Sandbox traversal guard test; shell behind approval gate |
| Approval checkpoints | "Auto Review" | Integration tested | Approve/deny gate test; dialogue cards in UI |
| Pause / resume, kill | not stated | Locally tested | Kill switch route + `/kill` both pause scheduler (tests) |
| Failure recovery, bounded retry | not stated | Locally tested | Proactive engine: backoff, dead-letter, crash recovery tests |
| Durable logs | team sees every step | Locally tested | Run journal in store; Rust WAL ledger with idempotency keys |
| Runs with laptop closed | yes (cloud computer) | Not started | Mimir is desktop-hosted. Needs an always-on host; none provisioned |
| Own cloud computer per bot | yes | Not started | No cloud host provisioning |

## Teammates and collaboration

| Capability | Grok Bot | Mimir | Evidence / gap |
|---|---|---|---|
| Multiple bots, roles, per-bot tools/model | yes | Integration tested | Bots with sandbox per bot; e2e |
| Bot templates | 8 prebuilt | Locally tested | Team-bot templates route; 4-question forge fallback test |
| Bots hand off / bring in bots | yes | In progress | `/swarm` DAG runs planner→executor→critic in one process; not truly parallel workers |
| Shared team bot, accounts, roles | yes | Not started | Single local user; no accounts or org separation |
| Learns over time | yes | In progress | Memory import + RSI critic datasets (tests); no evaluated promotion loop |

## Integrations

| Capability | Grok Bot | Mimir | Evidence / gap |
|---|---|---|---|
| Slack, Teams | in-chat bot | Locally tested (outbound only) | Webhook posts with retry + DLQ test. No inbound Slack/Teams bot |
| Inbound webhooks | not stated | Locally tested | Per-bot `/v1/hooks/<token>` |
| GitHub | PRs | Locally tested (token) | Token stored in vault, link/unlink test. No OAuth |
| Gmail, Drive, Calendar | sign into tools | In progress | Token check only; OAuth sign-in not built (needs a Google Cloud OAuth client) |
| Meetings (Meet/Zoom/Teams) | joins calls | Not started | Needs consent design + meeting APIs |
| MCP | not stated | Locally tested (stdio) | stdio JSON-RPC discovery + call test. Streamable HTTP + OAuth MCP not built |

## Teach-a-task and automation

| Capability | Grok Bot | Mimir | Evidence / gap |
|---|---|---|---|
| Teach a workflow once | yes | Locally tested | Recording → routine conversion |
| Routines on a schedule | yes (Premium) | Integration tested | Interval/daily/file trigger, quiet hours, budget, digest; live scheduled run recorded in Rust ledger |
| Event triggers | not stated | Locally tested | File change, inbound webhook. Email trigger needs Gmail OAuth |
| Proactive suggestions | "take initiative" | In progress | Daily digest only; no model-written suggestions |

## Platforms and voice

| Capability | Grok Bot | Mimir | Evidence / gap |
|---|---|---|---|
| Windows desktop | "more downloads" | Release verified | Installer: install, launch, single instance, uninstall. Unsigned |
| macOS | Apple silicon | Not started | Needs a Mac/macOS CI runner |
| Linux | not stated | Not started | electron-builder can target AppImage; not built or tested |
| iOS | yes | Not started | Needs Apple tooling + signing |
| Android | general Grok app only | Not started | — |
| Web / PWA | not stated | Integration tested (web) | Same UI over Vite dev server; PWA install not verified |
| Voice | not listed for Bot | Locally tested | Offline SAPI TTS test; `/voice` and Speak button. STT route exists, not tested; no push-to-talk UI |

## Models (bring your own)

| Capability | Mimir | Evidence / gap |
|---|---|---|
| Ollama | Integration tested | Live tool turn |
| OpenAI-compatible endpoint | Locally tested | SSE fallback test |
| Anthropic / Gemini / Groq / OpenRouter native adapters | Not started | Only reachable through OpenAI-compatible gateways today |
| Auto-discover local servers, 4-screen setup wizard | Not started | Highest-value next item |
| Local-only mode guarantee | Not started | Router exists; no enforced local-only switch |

## Recommended next slices (P0/P1 order)

1. **Model setup wizard + local-only mode**: discover Ollama / LM Studio / llama.cpp on known ports, probe streaming + tool calling, enforce local-only routing. Testable fully offline.
2. **Streamable HTTP MCP adapter** with OAuth discovery, tested against a local mock auth server.
3. **Browser task test**: a real multi-step click/type/download flow against a local fixture site, plus takeover-on-challenge.
4. **Parallel swarm workers** with per-worker budgets on the existing queue.
5. Gmail/Drive OAuth once a Google Cloud OAuth client ID is supplied.

Items that need something only the user can provide: code-signing certificate, Google OAuth client, macOS/iOS build host, always-on server.
