# MIMIR Omni — Threat Model & Security Controls

## 1. Trust Boundaries

| Boundary | Untrusted Inputs | Control Enforced |
| :--- | :--- | :--- |
| **Web Content / DOM / Search** | External web pages, emails, search snippets, fetched URLs (prompt injection risk) | Untrusted web excerpts wrapped in explicit `<untrusted_web_content>` isolation markers; model instructions never parsed from web DOM; sensitive tools (`shell_exec`, `fs_write`, `vault_use`, connector `send`) blocked from auto-executing without Human Approval Gate or allowed policy. |
| **HTTP / WS Coordinator API** | Requests from renderer, local apps, or external webhooks | Loopback bind (`127.0.0.1`), `isAllowedOrigin()` strict host check (`localhost` / `127.0.0.1` / `file://`), mandatory `X-GrokBot-Token` bearer authentication, WebSocket auth handshake, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, CSP headers. |
| **Agent Filesystem (`sandboxes/`)** | Model-supplied file paths (`../`, junction/symlink escapes, Windows UNC/device paths `\\.\`, ADS streams) | **Rust `canonicalize_under_sandbox(root, rel)`**: rejects drive prefixes, `..` traversal, Windows reserved names (`CON`, `NUL`, `PRN`), alternate data streams (`:`), and verifies canonicalized existing ancestor resolves strictly inside canonicalized sandbox root. |
| **Shell & Desktop Automation** | `shell_exec`, OS window/mouse/keyboard actions, Own-Computer browser actions | Default `ask-writes` / explicit **Runic Approval Gate** before execution; global **Kill Switch** immediately halts active Playwright/desktop runs and subprocesses; secret redaction applied to stdout/stderr before storage or UI display. |
| **Vault & OAuth Connectors** | API keys, passwords, OAuth access/refresh tokens | **Rust AEAD Vault** (`ChaCha20-Poly1305` / `AES-256-GCM`) with `ZeroizeOnDrop` key buffers, `32`-byte random salt, scrypt/Argon2 KDF, and automatic `redact_secrets()` across logs, chat messages, tool results, and diagnostic exports. |
| **Plugin / MCP Subprocesses** | Third-party MCP stdio/HTTP servers | Explicit permission badges (`read-only` vs `read+send`), env sanitization (do not leak unrelated Vault secrets to arbitrary MCP child processes), per-tool disable switches, and schema validation before invocation. |
| **Desktop Electron Renderer** | UI JS context | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, preload whitelist (`electron/preload.cjs`), `will-navigate` & `setWindowOpenHandler` blocked to external origins except validated HTTPS URLs via explicit user click. |

## 2. Residual Risks & Explicit Non-Claims
- Local loopback security relies on host OS user account isolation; another malicious process running as the same Windows user can read user-profile files unless locked by OS user permissions or an explicit user vault passphrase.
- Free-tier external cloud browsers or third-party OAuth apps require user sign-in/credentials owned by the user; MIMIR never ships shared credentials or CAPTCHA-bypass tooling (when CAPTCHA/MFA appears, MIMIR transitions cleanly to `blocked_by_challenge` and asks the human user to take over in the viewport).
