# Component Decisions (`component.gallery` Patterns)

## 1. Navigation Tabs & Preview Sub-Tabs (WAI-ARIA Tabs Pattern)
- **Usage**: Primary view navigation (`Chat`, `Agents`, `Forge AI`, `RSI & Scale`, `Routines`, `MCP Box`, `Vault`, `Settings`) and Realm Preview sub-tabs (`Screen`, `Elements & Workspace`, `Memories`).
- **Behavior**:
  - Container carries `role="tablist"` with clear `aria-label`.
  - Each item uses `role="tab"`, `aria-selected={isActive}`, and handles Left/Right (or Up/Down in vertical rail) keyboard focus safely while activating on click or Enter/Space.
  - Strictly ONE active tab receives the Brass (`#d4a243`) indicator rule; inactive tabs never carry persistent borders or glow.

## 2. Modal Dialog (`BotManagerModal` / `AgentConfigModal`)
- **Usage**: Creating or configuring an agent manually.
- **Behavior**:
  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to dialog title.
  - Pressing `Escape` closes the modal immediately; clicking the flat dimmed backdrop (`rgba(8, 10, 14, 0.78)`, no backdrop blur) closes the modal; clicking inside stops propagation.
  - Focus lands on the primary Name input on mount.

## 3. Agent Switcher vs Rename Control (Fixing Accidental Rename & Session Bug)
- **Root defect fixed**: In previous versions, inline rename/edit buttons cramped inside narrow rows caused users clicking an ally to open the Configure/Rename modal or silently reload the previous stale thread.
- **Decision**:
  - Dedicated **Agents** workspace view (`activeTab === 'agents'`) displays clear cards/rows with **explicit separate buttons**:
    1. `New Session` (primary action — creates a fresh conversation with that ally).
    2. `Resume` (loads latest chronicle if one exists).
    3. `Configure` (opens Configure/Rename modal explicitly — never triggered by clicking the ally row itself).
  - In the compact Sidebar ally list, clicking an ally opens that ally's clean workspace/session selector or fresh thread, while `Configure` sits as a clearly padded (`min-width: 28px`, `gap: 8px`) secondary control hidden cleanly until hover/focus or accessed via the Agents view, completely preventing accidental hits on `320px–768px` viewports.

## 4. Disclosure / Collapsible Reasoning & Tool Logs
- **Behavior**: Native `<details>` / `<summary>` (zero JS state bloat) for model `<think>` traces and long raw JSON arguments inside `ChatView`, with crisp monochrome `>` indicator rotating `90deg` when `[open]`.

## 5. Checkbox Cards (4-Question Follow-Up Forge Wizard)
- **Behavior**: Native `<input type="checkbox">` visually skinned with sharp `2px` chamfered stone borders + checkmark SVG inside a clickable `<label>` card (`min-height: 44px` touch target). Keyboard Spacebar, screen readers, and Playwright `.click()` work natively without custom ARIA divergence.

## 6. Responsive Drawer (`<= 900px` Viewports)
- **Behavior**: Below `900px`, the fixed `256px` left sidebar converts into an off-canvas slide-over drawer triggered by a single hamburger menu button in the topbar (`aria-expanded`, `aria-controls="mimir-sidebar"`, closes automatically on thread/tab selection or backdrop tap). The Realm Browser Preview converts from a docked right column (`>= 1120px`) into an inline toggleable full-width sheet below `1120px` so horizontal scroll is **0px** at `768x1024`, `390x844`, and `320x720`.
