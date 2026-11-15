# Yggdrasil Memory Schema (`YGGDRASIL_MEMORY_SCHEMA.md`)

## 1. Live Knowledge Graph (`daemon/project-map.mjs`, `renderer/components/RealmProjectMapView.jsx`)
Yggdrasil operates as a live, multi-realm interactive knowledge graph (`graph`, `list`, and `timeline` modes) backed directly by `AppStore`, `ArtifactFoundry`, workspace files on disk, `ResearchRuns`, `Receipts`, and `RagEngine`.

## 2. Supported Node Types (11+ Core Entity Types)
`User`, `Project`, `File`, `Task`, `Conversation`, `Bot`, `Memory`, `Source`, `Evidence`, `Decision`, `Skill`, `Artifact`, `Timeline event`.

- **Workspace `File` Nodes**: Live filesystem stat inspection across `daemon/` (`coordinator.mjs`, `contracts.mjs`, `sentinel.mjs`, `norse-agents.mjs`, `intelligent-ui.mjs`, `agent-runner.mjs`, `foundry.mjs`), `scripts/` (`creative_studio_builder.py`), and `renderer/` (`App.jsx`, `ChatView.jsx`, `MimirAvatarSvg.jsx`), carrying byte sizes, modified timestamps, and click-to-open `openTarget` routing hints.

## 3. Provenance, Staleness, Tenant Isolation & User Controls
- Every node includes `userId` tenant isolation, `provenance`, `confidence`, `verified`, `createdAt`, `updatedAt`, and `stale` flag (entries older than 30 days are surfaced in `diagnostics.staleMemories`).
- Diagnostics report live counts (`nodeCountsByType`), duplicate labels, stale items, and contradictory `Memory`/`Decision` keys.
- Users can search, filter by entity type, inspect provenance in the side drawer, edit memories inline (`POST /v1/memory`), delete via audit tombstone (`DELETE /v1/memory/:key`), or click **Open in [tab]** to navigate straight to the live record.
