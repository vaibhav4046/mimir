# End-to-End User Journeys (`E2E_USER_JOURNEYS.md`)

## Verified Automated Journeys

1. **First-Run Setup, Chat, Stop & Live Browser (`tests/e2e-ui.mjs`)**:
   - Launches real `coordinator` (:random port) + static built `dist/renderer/` in headless Chromium.
   - Verifies clean empty Home screen ("What would you like to get done?"), natural message submission, file staging/attachment, streaming reply rendering, and Kill Switch abort (`[data-testid="kill-switch-btn"]` -> `[data-testid="kill-notice-pill"]`).
2. **Norse Specialist Registry & Spaces (`tests/e2e-ui.mjs`, `tests/mimir-os-architecture.test.mjs`)**:
   - Navigates into Advanced Tools -> Agents, verifies all 11 Norse roles (`mimir`, `scout`, `forge-master`, `artificer`, `sentinel`, etc.) render cleanly with budgets and risk boundaries.
   - Creates a custom pinned Space (`Rust Forge (code)`) in the Sidebar, verifies persistence via `GET/POST/DELETE /v1/spaces`.
3. **Living Mimir Avatar & Reduced Motion (`tests/e2e-ui.mjs`)**:
   - Navigates to Settings, toggles `[data-testid="static-avatar-checkbox"]`, verifies `[data-testid="mimir-living-avatar"]` immediately reflects `data-reduced-motion="true"` across the UI.
4. **Intelligent UI Validation & Sentinel Enforcement (`tests/mimir-os-architecture.test.mjs`)**:
   - Confirms `POST /v1/ui/plan` produces a schema-valid `UISpecification`, `POST /v1/ui/action` persists checklist toggles through Sentinel, and malicious XSS specs (`<script>`) or unauthorized tool calls (`scout` -> `shell_exec`, `.vault` reads, SSRF metadata, `localOnly` escape) are blocked with HTTP 403 + redacted audit entries.
5. **Yggdrasil 11-Entity Graph & Tenant Isolation (`tests/mimir-os-architecture.test.mjs`, `tests/trustworthy-golden-path.test.mjs`)**:
   - Verifies `File` nodes with `openTarget` hints, duplicate/contradiction/staleness diagnostics, and strict cross-user isolation (`user-a` vs `user-b`).
6. **Multi-Viewport Layout Verification (`tests/e2e-ui.mjs`)**:
   - Captures screenshots and asserts `scrollWidth - innerWidth <= 2px` (zero horizontal overflow) at `1440x900`, `1280x800`, `768x1024`, `390x844`, and `320x720` across both the main workspace and the public landing page, with 0 console errors and 0 page errors.
