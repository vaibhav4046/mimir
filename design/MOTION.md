# Motion & Pixel Glitch System — Mimir (`MOTION.md`)

**References Applied**: `motion-ui` (`v4.2` performance & transform/opacity discipline), **Emil Kowalski** micro-interaction easing (`cubic-bezier(0.22, 1, 0.36, 1)` quint deceleration, tactile `translateY(1px)` press, responsive 150–250ms transitions), `impeccable/reference/animate.md` (`100/300/500` budget, visible-by-default reveals that never trap headless renderers in `opacity: 0`), and `@media (prefers-reduced-motion: reduce)` mandatory fallbacks.

---

## 1. Functional Motion Inventory

| Motion ID | Trigger | Purpose & Meaning | Timing & Easing | Reduced-Motion Fallback |
| :--- | :--- | :--- | :--- | :--- |
| **`mimir-sage-hover`** | Empty state / idle portrait (`MimirPortrait`) | Keeps Mimir's floating bald head subtly alive via discrete pixel steps (`steps(4)` `0 -> -2px -> 0`) + gentle cyan eye glow pulse | `2.4s steps(4, end) infinite` | Static resting sprite; static eye glow |
| **`mimir-glitch-burst`** *(Signature)* | Tool `ERROR:` / `Denied`, `agent:error`, Abort, or Runic Gate summon | Signals disruption or high-stakes intervention via crisp 2-layer cyan/amber horizontal pixel-slice jitter (`clip-path` + `translateX`) | `260ms steps(4, end) 1` on state mount | Static crisp border & Cracked Runestone icon |
| **`response-stream-decode`** | Incoming assistant response / streaming chunk (`ChatView`) | Gives live streaming feedback as tokens arrive: Bifrost cyan cursor block (`█`) pulses in pixel steps and new message row runs a fast horizontal scan-sweep unlock (`clip-path: inset(0 100% 0 0 -> 0)`) over visible text | `220ms cubic-bezier(0.22, 1, 0.36, 1)` sweep; `650ms steps(2)` cursor blink | Full message shown instantaneously; static cursor indicator |
| **`tool-verdict-flash`** | Tool call resolves `EXECUTED` or `FAILED` | Confirms completion (`#3ac9ff`/`#38b87c` top scan bar) or alerts failure (`steps(3)` horizontal pixel tremor + Cracked Runestone crack pulse) | `240ms cubic-bezier(0.16, 1, 0.3, 1)` | Instant border/badge change |
| **`runic-loader-step`** | `isRunning` while waiting for LLM/tool | Stepped 8-frame pixel Elder Futhark Yggdrasil spinner (`steps(8)`) + horizontal Bifrost shimmer track inside thinking banner | `900ms steps(8, end) infinite` | Static Illuminated Rune working badge |
| **`bifrost-realm-warp`** | Switching Realms in `RealmNavigator` or navigating Preview | Reinforces spatial realm travel with a brief crisp Bifrost cyan vertical-bar pixel dissolve across the Preview bezel | `260ms cubic-bezier(0.22, 1, 0.36, 1)` | Instant realm palette & preview swap |
| **`view-panel-enter` & `stagger-list`** | Primary tab switch (`Agents`, `Forge`, `RSI`, etc.) or card render | Preserves spatial continuity via subtle `8px -> 0` vertical settle + capped `--i` stagger (`30ms * min(i, 6) <= 180ms`, never starting at invisible trapped state for critical DOM) | `180ms cubic-bezier(0.22, 1, 0.36, 1)` | Instant mount (`transform: none`) |
| **`pixel-reticle-focus`** | Hover / `:focus-visible` on cards, realm medallions, buttons | Crisp Norse brass L-bracket corner snap + `translateY(1px)` tactile actuation on press | `60ms–140ms ease-out` | Static focus outline (`2px solid var(--frost)`) |

---

## 2. Performance & Accessibility Rules
1. **GPU-only properties**: Only animate `transform`, `opacity`, `clip-path`, `border-color` — NEVER animate `width`, `height`, `top`, `left`, or trigger reflow on every keyframe.
2. **Visible-by-default DOM guarantee**: Every text node and interactive button renders into the DOM cleanly (`visibility: visible`) so screen readers and Playwright never stall waiting on entrance animations.
3. **Global Reduced Motion Switch**:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
Plus an explicit **`Reduce Animations`** toggle in `Settings` (`data-reduced-motion="true"`) if the user prefers zero motion at runtime.
