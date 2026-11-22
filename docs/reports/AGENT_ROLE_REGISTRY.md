# Norse Agent Role Registry (`AGENT_ROLE_REGISTRY.md`)

## 1. Registry Design (`daemon/norse-agents.mjs`)
All 11 Norse roles implement the `Agent` schema in `daemon/contracts.mjs`, sharing local Ollama models cleanly without spawning unrequested duplicate model instances.

## 2. Registered Functional Personas
| ID | Name | Archetype | Primary Responsibility | Model Assignment | Priority E2E |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `mimir` | Mimir | Sage | Central planner, surface routing, synthesis | `ollama:qwen3:1.7b` | Yes |
| `scout` | Scout | Atreus-inspired Pathfinder | Web search, Playwright navigation, citations | `ollama:qwen3:1.7b` | Yes |
| `forge-master` | Forge Master | Brok-inspired Master Smith | Code editing, builds, tests, runtime debugging | `ollama:qwen3.5:4b` | Yes |
| `artificer` | Artificer | Sindri-inspired Craftsman | Schema UI composition, SVG/CSS QA, polish | `ollama:qwen3.5:4b` | Yes |
| `guardian` | Guardian | Kratos-inspired Protector | High-impact shell & desktop gating | `ollama:qwen3.5:4b` | Bounded |
| `sentinel` | Sentinel | Heimdall-inspired Watcher | Independent policy enforcement & secret audit | `deterministic-policy-engine` | Bounded |
| `archivist` | Archivist | Odin-inspired Seeker | Yggdrasil graph, provenance & deduplication | `ollama:qwen3:1.7b` | Bounded |
| `restorer` | Restorer | Freya-inspired Mender | Failure diagnostics & offline degradation recovery | `ollama:qwen3:1.7b` | Bounded |
| `diplomat` | Diplomat | Týr-inspired Keeper | MCP servers, OAuth least-privilege scopes | `ollama:qwen3:1.7b` | Bounded |
| `operator` | Operator | Thor-inspired Force | Scheduled routines & batch workflows | `ollama:qwen3:1.7b` | Bounded |
| `creator` | Creator | Angrboda-inspired Shaper | Images, 3D GLB/OBJ meshes, WAV audio, video | `ollama:qwen3.5:4b` | Bounded |

## 3. Endpoints & Routing
- `GET /v1/agents/registry` returns all 11 capability profiles with live worker state and contract validation.
- `POST /v1/agents/norse/seed` idempotently seeds the Norse specialist team into `AppStore`.
- `POST /v1/agents/route` selects the optimal role via `selectNorseRoleForTask(prompt, surface)`.
