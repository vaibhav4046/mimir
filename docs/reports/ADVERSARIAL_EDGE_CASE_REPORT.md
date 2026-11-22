# Adversarial Edge Case Report (`ADVERSARIAL_EDGE_CASE_REPORT.md`)

25 adversarial counterexamples audited across contracts, security, voice, multimodal workers, memory, and UI state:

| # | Counterexample | Defense / Mitigation | Status |
|---|---|---|---|
| C01 | Empty prompt submission | Composer blocks empty submit; coordinator rejects missing text (`400`) | Guarded |
| C02 | Ambiguous/broad prompt | Mode Auto-Detect badge previews classification; user override dropdown available | Guarded |
| C03 | Contradictory instructions (`always offline` + `search web`) | `localOnly` settings flag overrides and enforces offline mode at coordinator level | Guarded |
| C04 | Missing API key on remote provider | Clean explicit error surfaced; local Ollama fallback never fabricates remote calls | Guarded |
| C05 | Malformed tool/JSON output from small model | Reflexion repair pass + `detectToolOrJsonFormatFailure` prevents silent failure | Guarded |
| C06 | Invalid contract schema payload (`POST /v1/contracts/validate`) | `validateContract` rejects missing required fields / bad enums with HTTP `400` + explicit field list | Tested |
| C07 | Prompt injection inside imported memory or tool output | `memory-importer.mjs` & `agent-runner.mjs` fence untrusted strings with explicit non-instruction banner | Guarded |
| C08 | Path traversal in artifact/workspace paths | `foundry.mjs` & `local-exec.mjs` resolve & confine to allowed workspace/foundry directories | Guarded |
| C09 | XSS `<script>` payload in artifact title/prompt | `sanitizeCreativeText` strips `<script>`, `javascript:`, `on*=` attributes; `html.escape` in generators | Guarded |
| C10 | Cross-tenant user data access (`x-mimir-user`) | `resolveUserScope` isolates threads, memories, runs, and tombstones per tenant scope | Tested |
| C11 | Unsupported or forged artifact format | `ArtifactFoundry.createArtifact` rejects unknown formats deterministically | Guarded |
| C12 | Silent or clipped WAV music synthesis | `build_music_wav` asserts RMS `> 0.02`, clipping samples `== 0`, and re-reads WAV frame count | Tested |
| C13 | Generative video requested on 6GB GPU | Hardware detector gates Tier 2 (`>=12288 MiB`), routes cleanly to Tier 1 composition | Tested |
| C14 | Voice short backchannel (`"mm-hmm"`) during active TTS | `evaluateVoiceTurn` classifies backchannels (`bargeInTriggered: false`) and preserves speech | Tested |
| C15 | Voice real barge-in interruption (`"Stop change plan"`) | `evaluateVoiceTurn` sets `bargeInTriggered: true`, `ttsCancelled: true` | Tested |
| C16 | Oversized STT base64 payload (>12 MB) | `transcribeBase64` rejects payload immediately before writing temp files | Guarded |
| C17 | Duplicate or conflicting memory facts in Atlas | `buildMemoryAtlas` computes `duplicateNodes` and `contradictions` diagnostics | Tested |
| C18 | Stale memories (>30 days) polluting active context | `staleMemories` flagged in `diagnostics`; toggleable via `includeStale` filter | Tested |
| C19 | Rapid repeated Kill Switch / Abort clicks | `pullKillSwitch` is idempotent across active runs, browser sessions, and routines | Tested |
| C20 | Coordinator restarted mid-session | SQLite WAL + JSON fallback persists artifacts, threads, runs, and receipts | Tested |
| C21 | Python worker missing optional packages (`pyttsx3`) | `voice_engine.py` uses Windows native SAPI5 (`System.Speech.Synthesis`); zero crash | Verified |
| C22 | Slow/hung subprocess invocation | `execFile` timeouts (`3000ms`–`45000ms`) prevent event loop starvation | Guarded |
| C23 | Model Council invoked on trivial single-step chat | `councilEnabledByDefault: false` keeps fast single-model routing by default | Verified |
| C24 | Unverified self-graded quality score (`9.4/10`) | Replaced with measured structural `checksPassed / totalChecks` summaries | Verified |
| C25 | Modified `public/release-manifest.json` tracked files | Automated SHA-256 + byte-size manifest verification gate in `npm test` | Enforced |
