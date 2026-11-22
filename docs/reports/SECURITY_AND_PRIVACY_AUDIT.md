# Security & Privacy Audit (`SECURITY_AND_PRIVACY_AUDIT.md`)

## 1. Local Privacy & Least Privilege Boundaries
- **`localOnly` Mode**: Forces Ollama (`127.0.0.1:11434`), offline Windows SAPI5 TTS, and local `faster-whisper`, disabling remote API calls and web search in coordinator/rag/voice paths.
- **Tenant Isolation**: `resolveUserScope` partitions threads, runs, receipts, tombstones, and memories per `userId` (`default` / `local-owner` / custom header scope), verified against cross-tenant leakage.
- **Secret Vault & Redaction**: `daemon/vault.mjs` (`vault.redactText`, `redactValue`) redacts sensitive credentials across HTTP JSON responses, voice outputs, and logs.
- **Approval Gates**: Mutating/irreversible tools and MCP write operations route through explicit `Approval` records before execution.

## 2. Input Validation & Artifact Sealing
- **HTML & Prompt Sanitization**: `sanitizeCreativeText` strips inline script/handler payloads; Python HTML/SVG/PDF generators apply `html.escape` / XML escaping.
- **Contract Type Safety**: `POST /v1/contracts/validate` validates 14 schema types against required fields, primitive types, and lifecycle enums (`PENDING`..`CANCELLED`).
- **Cryptographic Receipts & Manifest**: Execution receipts form a hash chain (`hash` / `prevHash`), and `public/release-manifest.json` locks SHA-256 hashes and byte counts for critical runtime modules.
