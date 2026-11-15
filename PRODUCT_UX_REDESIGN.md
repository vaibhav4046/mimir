# Product UX Redesign (`PRODUCT_UX_REDESIGN.md`)

## 1. Simplified 6-Destination Navigation (`renderer/components/Sidebar.jsx`)
| Primary Label | View ID | `data-testid` | Purpose |
|---|---|---|---|
| **Home** | `chat` | `nav-chat` | Main workspace composer, adaptive workspace bar, live deliverables |
| **Projects** | `map` | `nav-map` | Yggdrasil Memory Atlas (11 entity types, hierarchy/graph views, diagnostics) |
| **Library** | `library` | `nav-library` | Searchable artifact vault, preview player, and multi-format downloads |
| **Automations** | `routines` | `nav-routines` | Scheduled routines, teachings/recordings, and research triggers |
| **Connections** | `mcp` | `nav-mcp` | MCP plugins, OAuth connectors, and local filesystem permissions |
| **Settings** | `settings` | `nav-settings` | Model selection, `localOnly` privacy lock, voice engine, and theme preferences |

Specialist views (`Overview`, `Agents`, `Studio`, `Boardroom`, `Eval & RSI`, `Architecture`, `Vault`) remain accessible inside a collapsible **Advanced Tools** drawer (`data-testid="toggle-advanced-tools"`).

## 2. Main Home Experience (`renderer/components/ChatView.jsx`)
- **Headline**: `"What would you like to get done?"` (`data-testid="home-hero-prompt"`)
- **Adaptive Workspace Bar (`data-testid="adaptive-workspace-bar"`)**:
  - Project Selector (`data-testid="composer-project-select"`)
  - Mode Override Dropdown (`data-testid="composer-mode-override"`: `Auto-Detect`, `Conversation`, `Coding & Web App`, `Deep Research`, `Music & Audio`, `Video Production`, `Images & 3D`, `Voice`, `Automation`)
  - Connect Account Shortcut (`data-testid="composer-connect-btn"`)
  - Live Detected Intent Indicator (`data-testid="smart-intent-badge"`)
- **Event-Driven Vocabulary (`UI_STATUS_VOCABULARY`)**: Plain-English states (`Searching sources`, `Building application`, `Running tests`, `Rendering video`, `Generating music`, `Waiting for approval`, `Preparing download`).
