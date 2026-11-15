# Living Mimir Avatar System (`AVATAR_ANIMATION_SYSTEM.md`)

## 1. Visual Design (`renderer/components/MimirAvatarSvg.jsx`)
- Original layered SVG vector state machine preserving Mimir's canonical character design: bald cranial dome, natural curved amber-ivory horns, weathered slate stone skin, glowing icy-cyan eyes (`#3ac9ff`), flowing grey-white beard with gold clasp, and subtle forehead/temple rune accents.
- No helmet, crown, or superhero letter "M" chest emblem.
- Wrapped cleanly by `MimirSagePortrait` in `renderer/components/MimirAsset.jsx` so Sidebar, Chat empty hero, Topbar, and `VoiceLiveModal` share one consistent identity.

## 2. Ten Truth-Derived States (`AVATAR_STATES`)
State is derived deterministically from real coordinator/voice/run signals via `deriveMimirAvatarState(...)`:
1. `IDLE` — Calm slate eyes & resting brow when no task/voice turn is active.
2. `LISTENING` — Elevated brow + cyan listening ring while microphone capture is active.
3. `THINKING` — Narrowed focus eyes + dashed orbital rune ring + illuminated temple runes while reasoning.
4. `WORKING` — High-luminance eyes + brass outer orbital ring while executing tools/runs.
5. `SPEAKING` — Mouth aperture & subtle jaw beard shift driven strictly proportionally to live `audioLevel` (`0..1`); never animates mouth when idle.
6. `WAITING_APPROVAL` — Amber eyes + amber exclamation badge when an irreversible tool approval is queued.
7. `BLOCKED` — Amber dashed lock ring + cross-shield indicator on Sentinel policy denial.
8. `FAILED` — Crimson eyes + crisp X overlay on run failure.
9. `COMPLETED` — Emerald halo + check glyph after turn verification completes.
10. `OFFLINE` — Dimmed desaturated eyes & offline outer ring when backend health is disconnected.

## 3. Accessibility & Reduced Motion
- Honors OS `prefers-reduced-motion: reduce` and explicit user preference (`staticAvatar` checkbox in Settings -> `localStorage['mimir-static-avatar']`), disabling CSS/SVG transitions while preserving clear state color and badge indicators.
