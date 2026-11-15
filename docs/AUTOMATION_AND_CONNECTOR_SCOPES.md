# Automation Security, Connectors Hub, Browser & Desktop Scopes

## 1. Connector Catalog & Scope Enforcement (`daemon/connectors.mjs`)

12 integrations across **Public** cloud services and **Personal** local bridges:

- **Cloud / SaaS Connectors**: `gmail`, `google-drive`, `google-calendar`, `github`, `slack`, `notion`, `linear`, `postgres`
- **Local / Browser Bridges**: `remote-desktop`, `sqlite`, `playwright`, `cloudflare`

Tokens are stored encrypted in `Vault` (`AES-256-GCM`) via `/v1/connectors/:id/connect`. Every connector exposes separate `read` vs `send` capabilities, with `defaultRequiresSendApproval: true` so read queries can execute without silent data egress while outbound sends, writes, and emails pause at an inline `Needs your OK` gate (`[Approve & Run]` / `[Allow Session]` / `[Deny]`).

## 2. Browser Guard & Prompt-Injection Fencing (`daemon/browser-guard.mjs`)

- **Explicit State Machine**: `idle -> connected -> authorized -> acting -> waiting_for_approval | blocked_by_challenge | failed | completed`.
- **Domain Allowlist (`isUrlAllowed`)**: Checks `browserAllowedDomains` (supporting wildcard patterns like `*.wikipedia.org`) and `browserStrictAllowlist`; loopback hosts remain permitted for local tests.
- **Anti-Bot / CAPTCHA Takeover (`blocked_by_challenge`)**: Detects turnstile/reCAPTCHA/hCaptcha/MFA gates, halts automated clicking immediately, and surfaces `POST /v1/computer/:botId/resume-challenge` for human completion. Never attempts automated bypasses.
- **Untrusted DOM Fencing (`wrapUntrustedExcerpt`)**: Wraps scraped page excerpts in `[UNTRUSTED WEB CONTENT START] ... [UNTRUSTED WEB CONTENT END]` markers.
- **Emergency Kill Switch (`POST /v1/kill-switch`)**: Aborts active agent runs and closes all browser sessions immediately.

## 3. Own Computer Control (`daemon/desktop-control.mjs` + `scripts/desktop_ctrl.py`)

Write actions (`click`, `type`, `hotkey`, `focus_window`) pass through `classifyDesktopApproval()` behind explicit approval gates. When invoked from a headless background service (Windows Session 0 where GDI window handles and screen capture are inaccessible), `desktop_ctrl.py` returns a structured `HEADLESS_SESSION` block rather than fabricating window lists.

## 4. Durable Routine Webhook Delivery (`daemon/routines.mjs`)

Outbound Slack/Teams routine webhooks execute bounded retries (2 attempts with `120 ms` backoff) and record persistent failures into `store.state.routineDlq`, exposed at `GET /v1/routines/dlq`.
