# Platform Build & Verification Matrix

| Target Platform | Architecture / Stack | Host Build Status | Notes & Constraints |
|---|---|---|---|
| **Web PWA + Coordinator Daemon** | React 18 + Vite + Node.js + Axum Rust sidecar (`mimir-daemon.exe`) | Verified on Windows x64 | Local WebSocket + HTTP API + Offline SAPI5 WAV + Playwright Chromium |
| **Windows Desktop App** | Electron + bundled UI + Rust `mimir-daemon.exe` | Verified build pipeline on Windows x64 | Uses Electron packaging; interactive session unlocks desktop capture |
| **Android Companion APK** | Kotlin / Jetpack Compose + `mimir-ffi` JNI (`libmimir_ffi.so`) | Cross-compiled via Android NDK (`aarch64-linux-android`, `x86_64-linux-android`) | Tested via Gradle `assembleDebug` + Android API 36 emulator (`adb`) |
| **macOS Desktop (`.app` / `.dmg`)** | macOS universal/arm64 + Xcode codesign | **CI-Only / Blocked on Windows Host** | Cannot legally or technically compile/notarize native Apple macOS binaries on Windows without macOS hardware + Xcode. Requires macOS GitHub Actions runner. |
