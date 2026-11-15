# Dependencies & Asset Policy (`DEPENDENCIES.md`)

- **Runtime UI Dependencies Added**: **None (`0` new packages)**.
  - Existing stack remains crisp and lightweight: `react`, `react-dom`, `playwright-core`, `ws`, `zod`, `vite`.
  - Icons are authored as lightweight internal React SVGs aligned to Tabler `24x24` `strokeWidth="1.75"` geometry (zero external font-icon pack bloat, zero multi-library icon inconsistency, offline desktop/Electron safe under strict CSP `default-src 'self'`).
- **Fonts**: System monospace / sans stack already available on Windows/macOS/Linux; zero remote Google Fonts network requests (guaranteed instant first paint and offline compliance).
- **3D / External Illustration Assets**: Intentionally **0** (Blush & Meshy skipped per `REFERENCE_BOARD.md`).
- **Security & Cost Policy**:
  - Browser automation uses local `playwright-core` (Embedded headless OR User's own Chrome/Edge via `--headless=false` / CDP `127.0.0.1:9222`) OR user-configured free remote CDP/WebSocket URL (`free-cloud`) — zero paid SaaS keys or metered proxy dependencies bundled.
