# Security Boundaries (`SECURITY_BOUNDARIES.md`)

## 1. Independent Sentinel Policy Service (`daemon/sentinel.mjs`)
Policy evaluation runs **outside** LLM prompts and agent instructions:
- **Tool Request Gate (`evaluateToolRequest`)**: Evaluates every `ToolRequest` prior to execution in `daemon/agent-runner.mjs` and `/v1/sentinel/evaluate`.
  - **Role Capability Matrix**: Enforces per-role `deniedTools` and `allowedTools` from `NORSE_AGENT_REGISTRY`.
  - **Secret Boundary**: Blocks reads targeting `.vault`, `vault.enc`, `.ssh`, `.aws`, `id_rsa`, or `.env` files (`SENTINEL_SECRET_BOUNDARY`).
  - **SSRF & Metadata Guard**: Blocks cloud metadata URLs (`169.254.169.254`, `metadata.google.internal`, `100.100.100.200`) (`SENTINEL_SSRF_METADATA`).
  - **Local-Only Network Enforcement**: Rejects outbound `http(s)` requests when `localOnly: true` (`SENTINEL_LOCAL_ONLY`).
  - **Prompt-Injection / Exfiltration Shield**: Detects instruction-override payloads and credential exfiltration patterns (`curl|wget|Invoke-WebRequest` paired with tokens `sk-`, `ghp_`, `xoxb-`, `vault.enc`) (`SENTINEL_INJECTION_SHIELD`).
  - **Destructive Command Approval**: Gates destructive shell patterns under `REQUIRE_APPROVAL`.
- **UI Action Gateway (`evaluateUiAction`)**: Re-authorizes every button click, form submit, checklist toggle, approval decision, and Space creation via `POST /v1/ui/action`. Unregistered `actionId`s are rejected with HTTP 403 (`SENTINEL_UNREGISTERED_UI_ACTION`).

## 2. Vault & Tenant Isolation
- Credentials stored via AES-256-GCM in `daemon/vault.mjs`; model contexts and Sentinel audit logs (`sentinel-audit.jsonl`) store redacted digests only.
- User scoping (`resolveUserScope` in `daemon/store.mjs` and `buildMemoryAtlas` in `daemon/project-map.mjs`) isolates threads, memories, runs, Spaces, and Yggdrasil graph nodes by tenant.
