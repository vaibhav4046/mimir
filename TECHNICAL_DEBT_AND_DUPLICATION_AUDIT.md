# Technical Debt & Duplication Audit (`TECHNICAL_DEBT_AND_DUPLICATION_AUDIT.md`)

## 1. Audited Duplicate & Conflicting Subsystems
| Area | Before State | Resurrection Resolution |
|---|---|---|
| Control Planes | Node `daemon/coordinator.mjs` + Python `mimri/services/core/app.py` | Consolidated on Node+Rust+SQLite WAL; `mimri/` subordinated to `subordinate-worker-only` |
| Entity Schemas | Implicit ad-hoc objects across store, runner, foundry, and voice | Unified 14 versioned schemas (`daemon/contracts.mjs`, v`2026.1`) with runtime validator |
| Self-Graded Badges | Hardcoded `score: 9.4` in `agent-runner.mjs` & `CreativeStudioPlayer.jsx` | Replaced with measured `checksPassed / totalChecks` structural verification summaries |
| Navigation Hierarchy | 13 top-level sidebar destinations exposed simultaneously | Simplified to 6 Core Destinations + collapsible `Advanced Tools` group |
| Multimodal Formats | Documents/Images/3D/Video/WebApps present; Audio/Music missing | Added stereo 44.1 kHz `.wav` music pipeline + multi-file Expense Tracker modules |
| Model Council | Risk of over-invoking multi-seat deliberation on trivial prompts | Explicitly marked `councilEnabledByDefault: false` (`opt-in-only-unless-benchmarked-superior`) |

## 2. Preserved Regression Compatibility
All 169 existing coordinator route handlers, `public/release-manifest.json` integrity hashes, `data-testid` selectors, and 73 baseline tests remain 100% functional without breaking upgrades.
