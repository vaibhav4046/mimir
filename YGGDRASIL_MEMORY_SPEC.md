# Yggdrasil Memory Atlas Specification (`YGGDRASIL_MEMORY_SPEC.md`)

**Backend Engine**: `daemon/project-map.mjs` (`buildMemoryAtlas`, `buildMidgardProjectMap`)  
**Frontend View**: `renderer/components/RealmProjectMapView.jsx` (`Projects` navigation destination)  
**Endpoints**: `GET /v1/projects/map`, `GET /v1/memory/atlas`, `POST /v1/memory/query`, `DELETE /v1/memory/:key`

## 1. All 11 Supported Entity Types
1. `Project` (`project-mimir`)
2. `File` (workspace source modules indexed on disk)
3. `Task` (scoped execution runs & goals)
4. `Conversation` (user threads & turn counts)
5. `Bot` (configured assistants & specialist personas)
6. `Memory` (tenant-scoped facts with provenance & confidence)
7. `Source` (retrieved research citations & URLs/paths)
8. `Decision` (extracted policies, rules & user preferences)
9. `Skill` (bot markdown skill files)
10. `Artifact` (generated Library files with SHA-256 digests)
11. `Timeline event` (hash-chained `EvidenceReceipt` timeline entries)

## 2. Governance, Diagnostics & UX Controls
- **Duplicate & Contradiction Diagnostics (`diagnostics`)**: Automatically detects normalized `type::label` duplicates, stale entries (>30 days), and conflicting `Memory`/`Decision` values for the same key.
- **View Modes**: Interactive Pan/Zoom **Graph View**, searchable **Atlas List**, and chronological **Timeline** (`data-testid="atlas-mode-graph|list|timeline"`).
- **Breadcrumbs & Deletion**: Clickable `data-testid="atlas-breadcrumbs"` trail plus tombstone-logged `DELETE /v1/memory/:key` cleanup.
