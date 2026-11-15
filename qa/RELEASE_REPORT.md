# Mimir Autonomous OS — Verified Release Report

**Version:** `1.0.3` (`mimir-security/1.1.0`)
**Workspace:** `D:\project\grok-bot-clone`

## 1. Build Artifacts Verified on Disk

| Platform / Target | Output Path | Size (Bytes) | Notes |
|---|---|---:|---|
| Windows Installer (NSIS x64) | `release/Mimir Setup 1.0.3.exe` | `93,415,022` | Unsigned (`no signing info identified`); bundles Vite renderer (`dist/renderer/`), coordinator, and Rust sidecar |
| Windows Unpacked App | `release/win-unpacked/Mimir.exe` | `205,901,824` | Electron `37.2.6` x64 |
| Rust WAL Sidecar | `rust/target/release/mimir-daemon.exe` | `4,654,080` | Bundled into `resources/app.asar.unpacked/rust/target/release/mimir-daemon.exe` |
| Android Companion APK | `android/app/build/outputs/apk/debug/app-debug.apk` | `9,567,904` | Jetpack Compose Material3 companion (`ai.mimir.companion`, minSdk `24`, targetSdk `35`) |
| Android Rust FFI (`arm64-v8a`) | `rust/target/aarch64-linux-android/release/libmimir_ffi.so` | `551,376` | Built with Android NDK `27.1.12297006` |
| Android Rust FFI (`x86_64`) | `rust/target/x86_64-linux-android/release/libmimir_ffi.so` | `528,592` | Verified on Android 36 emulator (`mimir_api36`) |
| Web / PWA Shell | `dist/renderer/` (`index.html`, `public/manifest.webmanifest`, `public/sw.js`) | `409.82 kB` JS / `31.99 kB` CSS / `1.10 kB` HTML | Vite `6.4.6` production bundle |

## 2. Automated Verification Results (Post-Final Edit)

| Suite | Command | Result | Scope & Evidence |
|---|---|---|---|
| Node Unit & Integration | `npm test` | **30 / 30 passed** (`0` failed, `0` skipped, `33,162 ms`) | `daemon.test.mjs`, `proactive.test.mjs`, `commands.test.mjs`, `browser-task.test.mjs`, `mcp-oauth.test.mjs`, `model-setup.test.mjs` including live Ollama `qwen3:1.7b` tool execution |
| Playwright E2E UI | `npm run test:e2e` | **Passed** (`pageErrors: 0`, `consoleErrors: 0`) | Desktop/tablet/mobile (`1440x900`, `1280x800`, `768x1024`, `390x844`, `320x720`), Overview, Library, Midgard Project Map, MCP Plugins, Kill Switch, Foundry artifacts (`qa/screenshots/`) |
| Rust Workspace Tests | `cargo test --workspace` | **11 / 11 passed** (`0` failed) | `mimir-core` (`1`), `mimir-ffi` (`1`), `mimir-security` (`9`) |
| Android JUnit Tests | `gradle testDebugUnitTest assembleDebug --no-daemon` | **4 / 4 passed** (`0` failed, `0` skipped) | `MimirClientTest` JSON envelope/array/realmId parsing (`TEST-ai.mimir.companion.MimirClientTest.xml`) |
| Live Browser Check | Browser subagent `d8437f1d` on `http://127.0.0.1:5173/` | **Verified** (`visited_origins: http://127.0.0.1:5173`, `blocked_origins: none`) | Confirmed shell, Overview, Library, Project Map, MCP Box Plugins, Chat Mic button, and Kill Switch notice banner |

## 3. Emulator & Hardware Notes

- **Android 36 Emulator (`mimir_api36`, `x86_64`):** Booted with `BOOT_COMPLETED=1`, installed APK (`app-debug.apk` from pre-final-cleanup build prior to `4/4` JUnit rebuild), launched `ai.mimir.companion/.MainActivity` with `AndroidRuntime:E` clean. Screenshots (`qa/screenshots/android-companion.png`, `qa/screenshots/android-companion-ffi.png`) verified live Rust JNI (`mimir-security/1.1.0`, `Authorization: Bearer sk-[REDACTED]`), coordinator connection at `http://10.0.2.2:4567`, and `Nine Realms Telemetry (12 nodes)`.
- **Local Ollama Benchmarks (`docs/EVAL_REPORT.md` on `NVIDIA GeForce RTX 3050 6GB Laptop GPU`):**
  - `qwen3:1.7b` (`fast_local`): `3 / 3` (`100%`), `90.0 tok/s` peak / `48.8 tok/s` avg
  - `qwen3.5:4b` (`balanced_local`): `3 / 3` (`100%`), `40.0 tok/s` peak / `19.9 tok/s` avg
  - `qwen3.5:9b` (`heavy_local`): `3 / 3` (`100%`), `9.7 tok/s` peak / `5.1 tok/s` avg

## 4. Known Scope Boundaries & Blocked Items

- **macOS `.dmg` & Code Signing / Notarization:** Blocked on Windows host (`win32`); requires macOS + Xcode / Apple Developer ID toolchain.
- **External OAuth Vendor Flows:** OAuth 2.1 PKCE tested against local loopback fixture (`mcp-oauth.test.mjs`); third-party vendor logins require user-configured OAuth app credentials.
- **iOS Companion:** Not built (no macOS/Xcode on Windows host).
