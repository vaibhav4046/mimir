# Design System — Mimir ("16-Bit Basalt, Norse Gold & Icy Cyan Instrument")

## 1. Visual Thesis
Mimir is a **Norse-tech retro 16-bit pixel operations console**: ultra-sharp pixel silhouettes and purposeful runic choreography anchored in near-black basalt (`#081019` -> `#101722` -> `#1d2b3b`), trimmed cleanly with Norse gold (`#e6ab42`) for Mimir identity, realm crests, and governance gates, and illuminated with icy cyan (`#3ac9ff` / `#a9eeff`) strictly for active execution, streaming cursor telemetry, and primary triggers. Removing color or halting animation still preserves complete structural readability.

---

## 2. Mandatory Color Palette (WCAG Contrast Verified)
| Token | Dark Value (Default) | Light Value (`[data-theme="light"]`) | Semantic Role |
| :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#081019` | `#ebe4d5` | Near-black navy outer viewport backdrop |
| `--bg-rail` | `#101722` | `#e3dbc8` | Sidebar panel & deep inset surfaces |
| `--bg-surface` | `#1d2b3b` | `#f5efe2` | Primary cards, slate surface panels, composer box |
| `--bg-elevated` | `#243447` | `#dfd6c1` | Interactive hover/selected surfaces & well inputs |
| `--rule` | `#2b3c50` | `#bfb297` | Default `1px` crisp architectural border |
| `--rule-strong` | `#435c78` | `#7c6d51` | Active focus border / modal hairline frame |
| `--ink` | `#e5edf4` | `#181611` | Warm off-white primary copy (`>14:1` on canvas) |
| `--ink-muted` | `#91a8bd` | `#4d4435` | Secondary descriptions & labels (`>=6.4:1` on slate) |
| `--ink-subtle` | `#7d95ab` | `#665b48` | Metadata hints, timestamps, tabular labels (`>=4.9:1`) |
| `--brass` / `--gold` | `#e6ab42` | `#91610e` | Norse gold trim, headings, Runic Gate & Realm crests |
| `--brass-soft` | `rgba(230, 171, 66, 0.14)` | `rgba(145, 97, 14, 0.12)` | Subtle active gold wash |
| `--frost` / `--cyan` | `#3ac9ff` | `#13679e` | Icy cyan highlight, primary `.btn-primary` fill (`#081019` ink = `10.1:1`), active indicators |
| `--frost-hi` | `#a9eeff` | `#0c4b75` | Highlight ice gleam inside SVG pixel sprites & streaming scan cursor |
| `--frost-soft` | `rgba(58, 201, 255, 0.14)` | `rgba(19, 103, 158, 0.12)` | Active streaming highlight & tab wash |
| `--ok` | `#38b87c` | `#157a4c` | `Executed` / `Ollama Live` / `Circuit Closed` |
| `--warn` | `#e6ab42` | `#9b6200` | Pending Runic approval / Fallback state |
| `--err` | `#e85d2a` | `#b83214` | `Failed` / `Denied` / Cracked Runestone state |

---

## 3. Character & Asset Discipline
- **`mimir-head` Strict Appearance**: Bald weathered cranium with engraved temple runes, sweeping ringed gold/ivory horns, glowing `#3ac9ff`/`#a9eeff` eyes, and long flowing braided grey/ivory beard with brass clasps. **NO hat, NO helmet, NO letter "M" anywhere.**
- **SVG + Transparent PNG Rule**: Every sprite compiles from a real pixel buffer to crisp span-merged editable `<svg shape-rendering="crispEdges">` (zero `<image data:image/png>` wrappers) plus multi-size transparent `.png` exports rendered cleanly with `image-rendering: pixelated`.
- **Distinct Agent Pairs**: `forge-bot-brok` (cobalt-steel rugged broad build + smith hammer) vs `forge-bot-sindri` (burnished gold sleek artificer + calipers/goggles) clearly communicate Infra/Tools vs Refinement/QA roles without implying nonexistent capabilities.

---

## 4. Layout, Borders & Responsive Floor
- Desktop (`>= 1120px`): `256px` sidebar | `minmax(0, 1fr)` workspace | `410px` Realm Preview (`1280px`: `380px`).
- Tablet & Mobile (`<= 900px` / `768x1024` / `390x844` / `320x720`): Off-canvas slide drawer + collapsible Realm Preview (`0px` horizontal overflow guaranteed).
- Zero `backdrop-filter` liquid glass bloat, zero soft blurred drop shadows everywhere, zero purple-black tropes or generic SaaS cards.
