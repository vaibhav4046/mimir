# Mimir 24/7 proactive bot — research and design

Date: 2026-11-13. Scope: section 8 of the Omni master brief ("24/7 proactive automations without fake availability") and backlog row "Scheduler and event hooks".

## What "proactive" means in shipping products

| Product | Mechanism | What we took |
|---|---|---|
| OpenClaw heartbeat | Periodic agent turn (third-party guides say every 30 min by default) that reads a short `HEARTBEAT.md` checklist; separate cron jobs for exact timing. The gateway process must be running for anything to fire. | Two trigger types: interval ("heartbeat") and exact daily time. Same honesty rule: nothing fires unless the host process is up. |
| ChatGPT Pulse | Once-a-day background research, delivered as a small set of cards the next morning; cards expire; feedback and off switch. | A daily digest in a feed, not a stream of interruptions. Pause switch. |
| APScheduler | `coalesce` merges a backlog of missed runs into one; `misfire_grace_time` decides how late a job may still run. | Missed slots are coalesced into exactly one catch-up run. |

Sources (secondary unless marked; verify before quoting numbers):
- OpenClaw heartbeat docs (official, partial): https://docs.openclaw.ai/gateway/heartbeat.md
- OpenClaw cron vs heartbeat (third-party): https://www.ampere.sh/blog/cron-jobs-heartbeats-making-openclaw-proactive
- ChatGPT Pulse coverage (third-party): https://www.eweek.com/news/openai-chatgpt-pulse/ , https://www.theneuron.ai/explainer-articles/chatgpt-pulse-makes-ai-your-personal-research-assistant-while-you-sleep
- APScheduler job reference (official): https://apscheduler.readthedocs.io/en/stable/modules/job.html
- Android background limits (official): https://developer.android.com/develop/background-work

Not verified in this pass: exact OpenClaw defaults, current Pulse availability tier, APScheduler 3.x default grace time. They do not affect the design.

## Failure modes that matter, and how the engine handles each

| Failure | Behaviour | Test |
|---|---|---|
| Poll loop fires twice in one slot | Run is skipped: interval anchors on `lastRunAt`, daily on `lastSlotKey` | `interval routine…never double-fires` |
| PC asleep for 9 hours | One catch-up run, not nine | same test |
| Daily routine created after today's slot | Waits for tomorrow | `daily routine…` |
| Model/tool error | Retry with exponential backoff (1 min base) on the same slot; after `maxAttempts` (default 3) the run is dead-lettered and an alert is posted | `failure path…` |
| Process killed mid-run | Run was journaled before it started; next boot marks it `interrupted` and retries it once | `crash recovery…` |
| Runaway schedule | `maxRunsPerDay` budget (default 48); one alert per day when hit | `controls…` |
| User hits kill switch | Running work is killed **and** the scheduler pauses, persisted across restart | `HTTP…` |
| Night-time noise | Quiet hours defer starts; due work runs once when they end | `controls…` |

## What it is not

- **Not always-on.** `host: desktop`. It runs while this PC is awake and the coordinator process is alive. `scripts/mimir-autostart.ps1 -Install` (opt-in) starts it at logon and restarts it on exit; adding `-WakeAt 07:55` asks Windows to wake a sleeping PC daily at that time (needs wake timers enabled; not exercised in tests). A powered-off PC runs nothing. True 24/7 needs an always-on machine running the same coordinator.
- **At-least-once by default, at-most-once on request.** An interrupted run restarts from the beginning. Routines saved with `retryInterrupted: false` are dead-lettered instead of re-run — use it for anything that sends, buys or deletes. The runner's approval gate remains the main guard against duplicate outside actions.
- **Cross-process dedupe via the Rust ledger.** When the Rust sidecar is up, each run enqueues `routine:<slotKey>#<attempt>` on the `routines` queue; a duplicate key means another coordinator process already took the slot and the run is recorded as `skipped`. The UI journal still lives in `store.json`, so two coordinators sharing one data dir will still overwrite each other's journal — the ledger prevents double execution, not journal races. Without the sidecar the engine falls back to the single-process journal.
- **Daily slots look back one occurrence.** A slot that fell inside quiet hours or a sleep crossing midnight runs once afterwards.
- **File trigger.** `watchPath` runs a routine when a file/folder changes (2 s debounce, 60 s cooldown so a routine cannot re-trigger itself in a loop; not recursive). Per-bot inbound webhooks (`POST /v1/hooks/<token>`) already existed. Email triggers are not built — they need Gmail OAuth credentials.
- **Digest is deterministic.** It counts runs, approvals and dead letters; it does not call the model. For an LLM-written morning brief, create a daily routine with that prompt.

## Surface

- `daemon/proactive.mjs` — `ProactiveEngine` (the only scheduler; `RoutineManager.startScheduler` was removed).
- Routine fields: `dailyAt` (`HH:MM` local, overrides `intervalMinutes`), `watchPath`, `retryInterrupted`, `maxAttempts` (1–10).
- `GET /v1/proactive` → `{ status, runs, feed }`; `POST /v1/proactive/config` → `paused`, `quietHours`, `maxRunsPerDay`, `digestAt`; `POST /v1/proactive/feed/read`.
- WebSocket events: `proactive:run`, `proactive:feed`, `proactive:updated`.
- UI: Routines → "Mimir 24/7 Watch" panel.
- Tests: `tests/proactive.test.mjs` (6 tests, injected clock, no model needed).
