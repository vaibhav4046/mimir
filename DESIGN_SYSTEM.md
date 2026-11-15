# Design System (`DESIGN_SYSTEM.md`)

## 1. Original Norse Palette
| Token | Hex | Role |
|---|---|---|
| Void | `#081019` | Primary canvas & canvas-backed media backdrop |
| Basalt | `#101722` | Elevated surface cards, composer, and sidebar |
| Slate | `#1d2b3b` | Borders, interactive controls, and active states |
| Aged Gold | `#e6ab42` | Primary action emphasis, active rings, brass accents |
| Frost | `#3ac9ff` | Semantic links, waveform highlights, intent indicators |
| Pale Ice | `#a9eeff` | Hover emphasis & secondary glyphs |
| Parchment | `#e5edf4` | High-contrast readable primary body typography |

## 2. Character, Icons & Component Hygiene
- **Original Mimir Identity (`MimirAsset.jsx`)**: Bald horned sage with long beard (non-franchise, custom geometric SVG crest, zero oversized "M" monograms or helmets).
- **Zero Decorative Noise**: Slop badges and unverified numeric scores (`9.4/10`) removed; status pills report real measured state (`verified`, `PASS/FAIL`, `checksPassed/totalChecks`).
- **Accessibility & Contrast**: Focusable controls, semantic roles (`role="tablist"`, `aria-pressed`, `aria-label`), reduced-motion media toggle support via `[data-reduced-motion="true"]`.
