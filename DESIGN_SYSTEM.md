# Design System (`DESIGN_SYSTEM.md`)

## 1. Visual Identity & Craft Principles
- **Register**: Restrained Norse product craft. Neutral stone and slate layers carry daily work; Aged Gold (`--brass`) and Bifrost Cyan (`--frost`) mark active selections, intent, and primary actions.
- **Original Mimir Identity (`MimirAsset.jsx`)**: Bald horned sage with long beard (custom geometric SVG crest, zero oversized "M" monograms or helmets).
- **Zero Decorative Noise**: No decorative left stripes on cards, no glow spam, and no unverified numeric scores (`9.4/10`); status pills report real measured state (`verified`, `PASS/FAIL`, `checksPassed/totalChecks`).
- **Radius & Elevation Grammar**: Sharp control tokens (`2px` / `--sand-radius-sm: 4px`) for dense toolbars, lists, and inputs; `--sand-radius-md: 6px` and `--sand-radius-lg: 10px` for elevated panels, studio cards, and the composer.

## 2. Dark Theme Tokens (`:root`)
| Token | Hex / Value | Role |
|---|---|---|
| `--bg-canvas` | `#081019` | Primary canvas and canvas-backed media backdrop |
| `--bg-rail` / `--panel` | `#101722` | Sidebar, topbar, command palette, and tool rails |
| `--bg-surface` | `#1d2b3b` | Cards, inputs, and message surfaces |
| `--bg-elevated` | `#243549` | Hover surfaces, user bubbles, active pills |
| `--bg-code` | `#0b121c` | Code block and terminal preformatted surfaces |
| `--rule` | `#3b526b` | Subtle structural dividers |
| `--rule-strong` | `#6786a8` | Interactive control borders (>= 3.0:1 WCAG 1.4.11) |
| `--border-soft` | `rgba(229, 237, 244, 0.14)` | Low-emphasis hairline separators |
| `--ink` / `--ink-primary` | `#e5edf4` | Primary readable body typography |
| `--ink-muted` | `#91a8bd` | Secondary labels and metadata |
| `--ink-subtle` | `#8ea5bd` | Tertiary labels (>= 4.5:1 across all four dark surfaces) |
| `--brass` / `--gold` | `#e6ab42` | Active rings, primary headings, brass accents |
| `--brass-hi` | `#ffd878` | High-contrast active brass text |
| `--frost` | `#3ac9ff` | Semantic links, primary buttons, active focus outlines |
| `--frost-hi` | `#a9eeff` | Highlighted semantic text and inline code citations |
| `--ok` | `#38b87c` | Verified / passing status foreground (>= 4.9:1 on elevated) |
| `--warn` / `--warn-ink` | `#e6ab42` / `#ffd878` | Warning accents and readable warning text |
| `--err` / `--err-ink` | `#d94143` / `#ff8284` | Error border/fill (`--err`) and AA error text (`--err-ink`, >= 5.2:1) |
| `--topology-*` | `#070c16`..`#e5edf4` | Theme-tokenized team topology SVG variables |

## 3. Light Theme Tokens (`[data-theme="light"]`)
| Token | Hex / Value | Role |
|---|---|---|
| `--bg-canvas` | `#ebe4d5` | Warm parchment primary canvas |
| `--bg-rail` | `#e3dbc8` | Sidebar and topbar rail |
| `--bg-surface` / `--panel` | `#f5efe2` | Elevated cream cards and form inputs |
| `--bg-elevated` | `#dfd6c1` | Hover and active surface tier |
| `--bg-code` | `#e3dbc8` | Code block backdrop |
| `--rule` | `#85785e` | Structural dividers (>= 3.2:1 on elevated) |
| `--rule-strong` | `#665b45` | Interactive control borders (>= 4.6:1 on elevated) |
| `--border-soft` | `rgba(24, 22, 17, 0.14)` | Low-emphasis hairline separators |
| `--ink` / `--ink-primary` | `#181611` | Primary body typography |
| `--ink-muted` | `#4d4435` | Secondary metadata |
| `--ink-subtle` | `#5c5140` | Tertiary labels (>= 5.3:1 on elevated) |
| `--brass` / `--gold` | `#754c08` | Active headings and brass accents (>= 5.2:1 across all surfaces) |
| `--brass-hi` | `#5e3c05` | High-emphasis brass labels (>= 6.8:1) |
| `--frost` / `--sand-accent-hover` | `#0f5482` / `#0b4368` | Links, focus rings, primary button fill (`#ffffff` ink >= 8.0:1) |
| `--frost-hi` | `#0a4166` | Highlighted semantic text and active mode pills (>= 7.4:1) |
| `--ok` | `#11633d` | Passing status foreground (>= 5.0:1 across all surfaces) |
| `--warn` / `--warn-ink` | `#754c08` / `#5e3c05` | Warning borders and readable warning text |
| `--err` / `--err-ink` | `#9e280e` / `#8c210b` | Error borders and AA error text (>= 5.1:1 on tinted surfaces) |

## 4. WCAG AA Compliance & Interaction Rules
1. **Text Contrast (>= 4.5:1 normal text, >= 3.0:1 large text)**: All semantic foreground tokens (`--ink`, `--ink-muted`, `--ink-subtle`, `--brass`, `--brass-hi`, `--frost`, `--frost-hi`, `--ok`, `--warn-ink`, `--err-ink`) are verified against all four surface tiers (`canvas`, `rail`, `surface`, `elevated`) and soft alert backgrounds in both dark and light themes.
2. **Non-Text Contrast (>= 3.0:1, WCAG 1.4.11)**: Interactive inputs, selects, checkboxes, and button boundaries use `--rule-strong` rather than low-contrast structural hairlines.
3. **No Hardcoded Theme Slabs**: Cards, tables, studio players, modals, code blocks, and topology SVGs consume CSS custom properties so switching between dark and light themes remains cohesive without dark-only boxes.
4. **Keyboard Focus**: Never suppress `:focus-visible` with bare `outline: none`. All interactive controls, palette rows, wizard choices, and suggestion items expose a `2px solid var(--frost)` focus ring. Visually hidden file inputs use `.sr-only` with `:focus-visible` ring forwarding.
5. **Responsive & Touch Targets**: Mobile breakpoints (`<= 900px`, `<= 640px`) collapse quickbars into single-row horizontal strips or toggleable drawers and enforce `>= 36px` / `44px` tap targets with zero horizontal overflow (`scrollWidth <= innerWidth`).
6. **Reduced Motion**: Respect `prefers-reduced-motion: reduce` and `[data-reduced-motion="true"]`.

## 5. Core Component Class Contracts
- **Buttons & Pills**: `.btn`, `.btn-primary`, `.btn-gold`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.btn-icon`, `.pill`, `.pill.is-cyan`, `.pill.is-gold`, `.pill.is-emerald`, `.pill.is-ok`, `.pill.is-crimson`, `.pill.is-slate`
- **Feedback & Accessibility**: `.error-banner`, `.sr-only`
- **Command Palette (`Ctrl+K`)**: `.cmd-palette-backdrop`, `.cmd-palette-dialog`, `.cmd-palette-input`, `.cmd-palette-list`, `.cmd-palette-item`, `.cmd-palette-item.is-active`, `.cmd-palette-kbd`
- **Live Canvas Workbench**: `.canvas-pane`, `.canvas-toolbar`, `.canvas-editor`, `.canvas-preview-frame`, `.canvas-ai-bar`, `.canvas-diff-banner`
- **Branching, Mentions, Spaces, Research & Screen Targets**: `.branch-edit-banner`, `.msg-branch-bar`, `.mention-suggest`, `.mention-suggest-item`, `.mention-suggest-item.is-active`, `.research-stepper`, `.research-step-row`, `.screen-element-overlay`, `.screen-target-box`, `.spaces-strip`, `.space-badge`, `.space-editor-card`
