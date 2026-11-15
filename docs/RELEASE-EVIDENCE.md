# Mimir Public Release Golden Path — Verification & Evidence

- **Branch**: `fix/mimir-trustworthy-golden-path` (builds on `7feaf7c` + QA commit)
- **Production URL**: `https://mimir-site-dusky.vercel.app/` (Vercel deployment `dpl_8eG9wimTvZxax9hcxWTw3Czut8k1`, `READY`)
- **Web App Entry**: `https://mimir-site-dusky.vercel.app/app.html`

## P0 Fixes Implemented & Verified

1. **Public Web <-> Local Coordinator Pairing & Origin Isolation**
   - `daemon/coordinator.mjs`: Strict Origin allowlist (`https://mimir-site-dusky.vercel.app`, loopback origins, `null`/`file://`), Private Network Access preflight (`Access-Control-Allow-Private-Network: true`), secret-free `GET /v1/health`, two-step code exchange (`POST /v1/pairing/request` -> `POST /v1/pairing/exchange` issuing expiring `mimir_sess_*` tokens, 5-attempt lockout `429`), revocation (`POST /v1/pairing/revoke`), and structured `401` codes (`PAIRING_REQUIRED`, `SESSION_EXPIRED`).
   - `renderer/api.js` & `renderer/App.jsx` & `renderer/components/RuntimeConnectGate.jsx`: Scrubs any `?token=` query string, stores pairing sessions in `sessionStorage`, gates background data/WS subscriptions on `runtimeState.status === 'connected'` (with reactive `[runtimeState.status]` effect), and shows `RuntimeConnectGate` whenever disconnected, pairing is needed, or a session expires/is revoked.

2. **Honest Fixture vs Live Execution Separation (`public/landing/index.html`)**
   - Rebuilt landing page around the 5-second explanation, recorded local `qwen3:1.7b` trace (`6,818 ms`, `art-ad4df9a106`, `%PDF-1.4`, `2,200` bytes), 3-step setup, specialist permission cards, strictly labeled `Static Demo Fixture (NOT Live)` sandbox (`verdict: "simulated-demo"`, never `"verified"`), local `127.0.0.1:4567/v1/health` probe, Windows installer + SHA-256 table, comparison table, and collapsible `<details>` architecture section.

3. **Real End-to-End Task Execution**
   - Executed against live Ollama `qwen3:1.7b` (`127.0.0.1:11434`) with `approvalPolicy: 'always-ask'`: `WAITING_FOR_APPROVAL` -> human approval -> `COMPLETED`, producing verified `%PDF-1.4` deliverable `art-ad4df9a106` (`2,200` bytes, SHA-256 `c61c87e56b0387d0f406aeb68938e57b2383c0f2a9940b0207c169eecbb2b1b4`) and valid hash-chain receipts (`GET /v1/receipts/verify` -> `{ valid: true, count: 2, brokenIndex: null }`).

## Automated Verification Results (Run After Final Edits)

- **Rust Workspace (`cargo test --workspace --manifest-path rust/Cargo.toml`)**: `12` passed, `0` failed, `0` ignored (`mimir_core`: `1`, `mimir_ffi`: `1`, `mimir_security`: `10`).
- **Node Unit & Integration Suite (`npm test`)**: `83` passed, `0` failed, `0` skipped (`duration_ms: 88044.743`), covering pairing security, CORS/PNA preflight, revocation, brute-force lockout, expired session TTL (`401 SESSION_EXPIRED`), broken artifact `404` checks, HTTP `500` crash honest receipts, no-Ollama detection, static fixture honesty, 14 Mimri capabilities, research export, receipts, and voice fallback.
- **Playwright Browser E2E (`npm run test:e2e`)**: Passed (`pageErrors: 0`, `consoleErrors: 0`), exercising first-time `/app.html` offline gate -> two-step pairing -> expired session TTL recovery (`Pairing session expired`) -> unpairing, live Ollama `qwen3:1.7b` tool approval & `e2e-note.txt` creation, no-Ollama `Offline` status pill, offline-internet local PDF deliverable creation (`200 %PDF-`) + `404` broken download guard, active `[data-testid="abort-btn"]` cancellation, embedded Playwright browser navigation + Enlarge + Take Control, real coordinator restart (`coord.close()` -> restart on same `dataDir`) task persistence, and `0px` horizontal overflow across `1440`, `1280`, `768`, `390`, `320` viewports.
- **Windows NSIS Installer (`npm run dist:win`)**:
  - Artifact: `release\Mimir Setup 1.0.3.exe` (unsigned local build)
  - Size: `93,669,224` bytes
  - SHA-256: `dd2b6eb09c1b921f0df7e487469eb165b6f0438649cdb5def508ecb859f4273a`
  - Clean silent NSIS install to `%TEMP%\mimir-install-test`, `Mimir.exe` smoke launch (`MIMIR_SMOKE_TEST=1` -> `ok: true`, `hasDesktopBridge: true`, `hasSidebar: true`, `hasComputerPane: true`), and clean silent uninstall verified (`After uninstall exe exists: False`).
- **Live Vercel Production Check (`https://mimir-site-dusky.vercel.app/` & `/app.html`)**: Playwright check returned `ok: true`, landing images loaded (`imgsOk: true`), sandbox badge `Static Demo Fixture (NOT Live)`, `/app.html` renders `RuntimeConnectGate`, `pageErrors: 0`.

## Known Limitations

- Windows installer `Mimir Setup 1.0.3.exe` is an unsigned local NSIS build (`codeSigning: unsigned-local-build`).
- No remote GitHub repository is configured (`git remote -v` empty), so `release/Mimir Setup 1.0.3.exe` is built locally rather than hosted via a public release download URL.
