# Architecture: Current vs Target (`ARCHITECTURE_CURRENT_VS_TARGET.md`)

## 1. Control Plane Consolidation
Previously, MIMIR accumulated competing control-plane patterns across Node (`daemon/`), Python (`mimri/`), and multiple UI surfaces (`ChatView.jsx` ad-hoc cards).

In the rebuilt **MIMIR Intelligent Operating System**:
- **Single Primary Control Plane**: `daemon/coordinator.mjs` (:4567) + `daemon/store.mjs` (SQLite/WAL state & receipts) + `rust/` (`mimir-core`, `mimir-security`, `mimir-ffi`).
- **Independent Security Boundary**: `daemon/sentinel.mjs` (`SentinelPolicyService`) sits *outside* model prompts and gates every `ToolRequest`, `AgentHandoff`, and UI Action before execution.
- **Schema-Driven Intelligent UI**: `daemon/intelligent-ui.mjs` validates `UISpecification` payloads (`version: 1`) against 16 approved component blocks and 7 adaptive surfaces before `renderer/components/IntelligentUiRenderer.jsx` renders them.
- **Norse Functional Specialist Registry**: `daemon/norse-agents.mjs` defines 11 capability-bounded functional roles (`Mimir`, `Scout`, `Forge Master`, `Artificer`, `Guardian`, `Sentinel`, `Archivist`, `Restorer`, `Diplomat`, `Operator`, `Creator`) sharing local Ollama models cleanly.
- **Subordinate Workers**: `scripts/foundry_builder.py`, `scripts/creative_studio_builder.py`, `scripts/voice_engine.py`, `scripts/desktop_ctrl.py`, and `mimri/` remain bounded execution workers (`controlPlaneAuthority: "node-rust-sqlite-primary"`, `pythonRole: "subordinate-worker-only"`).

## 2. Authoritative Versioned Contracts (`daemon/contracts.mjs`)
- **Schema Version**: `2026.1`
- **Unified Lifecycle States (7)**: `PENDING`, `RUNNING`, `WAITING_FOR_INPUT`, `VERIFYING`, `COMPLETED`, `FAILED`, `CANCELLED`
- **20 Contract Schemas**: `Task`, `Run`, `Step`, `ToolCall`, `ToolResult`, `Approval`, `ModelInvocation`, `WorkerJob`, `Artifact`, `EvidenceReceipt`, `MemoryNode`, `ConnectorSession`, `VoiceTurn`, `MediaRender`, `Agent`, `AgentHandoff`, `ToolRequest`, `ExecutionEvent`, `UISpecification`, `AvatarState`.
- **Contracts Endpoints**: `GET /v1/contracts`, `POST /v1/contracts/validate`, `GET /v1/hardware/capabilities`.

## 3. Adaptive Execution & Security Dataflow
1. **Input & Context**: User prompt, voice turn, or dropped file enters `coordinator.mjs` (`POST /v1/agent/run` or `/v1/voice/duplex`).
2. **Planning & Role Routing**: `selectNorseRoleForTask` and `AgentRunner` route work cleanly (local models `qwen3:1.7b` / `qwen3.5:4b`, bounded tool curation, depth <= 2).
3. **Sentinel Policy Gate**: Every proposed `ToolRequest` and UI action passes through `SentinelPolicyService.evaluateToolRequest` / `evaluateUiAction` (`ALLOW` | `REQUIRE_APPROVAL` | `DENY`) with redact-before-persist audit logging.
4. **Verified Execution & Receipt**: Tool outputs, `Artifact` files, and `EvidenceReceipt` SHA-256 chain records are persisted atomically.
5. **Intelligent UI & Yggdrasil Indexing**: `planUiSpecification` generates a validated `UISpecification`; `buildMemoryAtlas` indexes typed nodes (`File`, `Artifact`, `Memory`, `Decision`, `Source`, `Task`, etc.); `MimirAvatarSvg` reflects exact live state (`IDLE` through `OFFLINE`).
