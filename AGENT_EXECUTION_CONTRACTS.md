# Agent Execution Contracts (`AGENT_EXECUTION_CONTRACTS.md`)

**Authoritative Module**: `daemon/contracts.mjs` (`SCHEMA_VERSION = "2026.1"`)  
**HTTP API**: `GET /v1/contracts`, `POST /v1/contracts/validate`

## 1. Unified 7-State Task Lifecycle
`PENDING` -> `RUNNING` -> `WAITING_FOR_INPUT` -> `VERIFYING` -> `COMPLETED` | `FAILED` | `CANCELLED`

## 2. Standard 5-Phase Agent Loop
`Understand` -> `Plan` -> `Execute` -> `Verify` -> `Deliver`

## 3. All 14 Versioned Schema Contracts
1. `Task` (`id`, `title`, `prompt`, `mode`, `status`, `userId`, `createdAt`, `updatedAt`)
2. `Run` (`id`, `taskId`, `status`, `uiStatus`, `startedAt`)
3. `Step` (`id`, `runId`, `phase`, `status`, `summary`)
4. `ToolCall` (`id`, `runId`, `toolName`, `arguments`, `riskTier`, `requestedAt`)
5. `ToolResult` (`callId`, `ok`, `outputSummary`, `durationMs`)
6. `Approval` (`id`, `runId`, `action`, `status`, `reason`)
7. `ModelInvocation` (`id`, `provider`, `model`, `localOnly`, `latencyMs`)
8. `WorkerJob` (`id`, `workerType`, `status`, `payload`, `createdAt`)
9. `Artifact` (`id`, `title`, `format`, `category`, `bytes`, `sha256`, `createdAt`)
10. `EvidenceReceipt` (`id`, `action`, `hash`, `prevHash`, `verified`, `timestamp`)
11. `MemoryNode` (`id`, `type` [11 atlas types], `label`, `updatedAt`)
12. `ConnectorSession` (`id`, `connectorId`, `status`, `updatedAt`)
13. `VoiceTurn` (`id`, `transcript`, `durationMs`, `isBackchannel`, `bargeInTriggered`, `endToEndLatencyMs`)
14. `MediaRender` (`id`, `mediaType`, `tier`, `hardwareRequired`, `qaPassed`, `qaChecks`)
