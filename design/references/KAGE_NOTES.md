# Kage Notes — Product Composition & Density Extraction (`kage.design`)

## Selected Archetypes Analyzed

### 1. Precision Developer Workbench (Split-Pane IDE / Terminal Inspector Archetype)
- **What makes it feel expensive**: Zero decorative card nesting inside the main viewport. Panes are separated by crisp `1px` architectural hairlines (`--rule`), monospace telemetry aligns cleanly on `tabular-nums`, and the canvas occupies >= 92% of the viewport width without marketing chrome.
- **Dominant layout grammar**: Asymmetric 3-band shell (`240px–264px` navigation rail | flexible fluid workstream `minmax(0, 1fr)` | contextual inspection dock `380px–420px` collapsible on viewports `< 1120px`).
- **Typography hierarchy**: Monospace / technical grotesk pair where uppercase tracking (`0.08em`, `11px`) anchors section metadata while `13.5px` high-legibility mono/sans handles prose and code cleanly.
- **Spacing rhythm**: Strict `4px` base grid (`4 / 8 / 12 / 16 / 24px`) with dense controls (`32px–36px` bar heights) inside utility toolbars and generous (`16px–20px`) breathing room around message blocks.
- **Interaction idea**: Persistent contextual status strip (provider + queue load + active browser engine mode) clickable to jump directly to diagnostics without popup alerts.
- **What NOT to copy**: Dark purple/magenta syntax highlighting themes, fake terminal macOS traffic-light dots (`🔴🟡🟢`), or fake animated ASCII command logs.

### 2. Modular Knowledge & Memory Archive (Minimal Workbench / Notebook Archetype)
- **What makes it feel expensive**: Quiet flat surfaces differentiated solely by controlled 4–6% luminance steps (`#0c1016` -> `#121821` -> `#18202b`) and crisp `1px` rules—never box-shadows or frosted glass blur.
- **Dominant layout grammar**: Left index tree + centered `720px–820px` max-measure reading/composer column that remains legible even when side docks close.
- **Typography hierarchy**: Clear distinction between mutable status values (frost cyan `#5cc8ff` or brass `#d4a243`) and structural chrome (warm stone `#9eb0c4`).
- **Spacing rhythm**: Vertical lists grouped by explicit hairline dividers with `8px` row separation so clicking a row never hits an unintended adjacent icon button.
- **Interaction idea**: Separated primary row action vs secondary overflow/settings button with minimum `32px` hit targets and explicit `gap` (`8px`).
- **What NOT to copy**: Soft `24px` pill radii everywhere, bento marketing feature cards, or decorative gradient banners.

### 3. Hardware Instrument / Telemetry Console (Flight-Recorder Archetype)
- **What makes it feel expensive**: Every indicator maps to a real live number or boolean state (queue depth, circuit breaker `CLOSED`/`OPEN`, grounded DOM coordinate overlays). Zero fake sparks or unbacked gauges.
- **Dominant layout grammar**: Dense 2-column inspector cards above raw machine logs, with scannable state tags (`READY`, `RUNNING`, `FAILED`, `DENIED`) colored solely by semantic status.
- **Typography hierarchy**: `font-variant-numeric: tabular-nums` on every counter, port, latency ms, and dataset count.
- **Spacing rhythm**: Compact `12px` card padding with clear `1px` horizontal internal rules between input/action strips and live output readouts.
- **Interaction idea**: Direct interactive click-layer over the live browser viewport JPEG displaying real coordinates (`x, y`) and extracted interactive DOM selector buttons.
- **What NOT to copy**: Glowing neon borders, pulse animations on idle telemetry badges, or fake live streaming charts.
