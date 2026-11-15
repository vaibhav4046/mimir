# Windows release

Build: `npm run dist:win` → `release/Mimir Setup <version>.exe` (NSIS, x64, per-user, no admin).

## Packaging layout
- `app.asar` holds the Electron shell and renderer.
- `app.asar.unpacked/` holds `daemon/`, `scripts/`, `rust/` and `node_modules/`: the coordinator runs as a plain Node child and spawns the Rust sidecar and Python scripts, which must be real files. `electron/main.cjs` rewrites the daemon path to `app.asar.unpacked`.

## Code signing
The installer is unsigned, so SmartScreen warns on first run. electron-builder signs automatically when these env vars are set at build time:

```
CSC_LINK=<path or base64 of .pfx>
CSC_KEY_PASSWORD=<pfx password>
```

A certificate must come from a CA (OV or EV code-signing; EV builds SmartScreen reputation immediately). A self-signed certificate does not remove the warning on other machines.

## Runtimes not bundled
Ollama, Python and a browser are detected at runtime. Settings → "This computer" (`GET /v1/preflight`) shows what is missing with the exact install command. Browser tools fall back to installed Chrome or Edge. Python packages: `scripts/requirements.txt`.

## Verified on this machine (1.0.4, 2026-11-15)

Release asset name on GitHub is `Mimir-Setup-<version>.exe` (the local file has spaces; rename before upload so the landing-page link stays valid). Bump `package.json` and `daemon/version.mjs` together, then `npm run manifest`.
| Check | Result |
|---|---|
| Installed copy, smoke mode on a fresh profile | ok; opens on the first-run setup screen, which the check accepts |
| Silent install `/S /D=<dir>` | exit 0; exe, uninstaller, registry entry, Start menu + desktop shortcuts present |
| Installed copy, smoke mode | ok |
| Installed copy, normal mode | coordinator `/health` ok, main window shown, second launch exits (single instance) |
| Silent uninstall | exe, registry entry, both shortcuts removed; user data kept; empty install folder left behind |

## Not verified
- Tray icon (not readable from scripts; tray code path ran without error).
- `scripts/mimir-autostart.ps1 -Install` (registering the task was not permitted in the test session; script parse-checked only), `-WakeAt` wake from sleep.
- A clean machine without Node, Python, Ollama or Chrome.
- Signed build.

## Naming
Environment variables are `MIMIR_*` (`MIMIR_PORT`, `MIMIR_TOKEN`, `MIMIR_DATA_DIR`, `MIMIR_CHROMIUM_PATH`, `MIMIR_SMOKE_TEST`). The old `GROKBOT_*` names are still read as a fallback. Two internal identifiers keep the old name on purpose: the default bot id `bot-grok-default` (referenced by stored threads, routines and sandboxes) and the vault key salt (changing it would lock existing vaults). The repository folder is still named `grok-bot-clone`; renaming it is a manual step outside the code.

