# frontend — dice (SvelteKit SPA)

SvelteKit + Svelte 5 runes + adapter-static (→ `dist/`). See the root CLAUDE.md
for the game invariants. `yarn validate` (lint + format + typecheck) must be clean.

## Structure

- `routes/+page.svelte` — lobby (create / join by code).
- Opening an invite link **joins immediately** — no name is asked for first (an
  empty name becomes "Player N" server-side), then a dismissible rename dialog
  appears, skipped entirely when this browser already has a name. The old
  ask-first form sat between the link and the game for ~80s in the access logs,
  long enough for the room to be closed underneath the newcomer. E2E specs drive
  this through `e2e/helpers.ts::setNameInDialog` — keep it there, seven specs use it.
- `routes/g/[code]/+page.svelte` — the game table (composition root); wires stores
  ↔ components, owns connect/leave.
- `lib/stores/*.svelte.ts` — reactive state: `session` (name + per-game creds in
  localStorage), `game` (snapshot + `lastRoll`), `ws` (WebSocket client, nib
  pattern + auto-reconnect), `theme` (light/dark/auto → `data-theme`), `audio`
  (Web Audio synth), `shake` (DeviceMotion).
- `lib/components/` — `DiceStage` (3D canvas or nixie branch + input),
  `NixieDice`, `PlayerList` (pointer drag-reorder), `Toolbar`, `RollHistory`,
  `SharePanel` (QR + copy), `DiceThemeSelect`, toggles, `Wordmark`.
- `lib/dice/` — `DiceScene.ts` (3D physics dice engine), `orient.ts` (relabel
  math, unit-tested), `nixieScene.ts` (3D nixie-tube scene), `themes.ts`.
- `lib/api.ts` — fetch wrapper + the TS mirror of the Rust wire types, plus
  `failReason` (the shared failure classifier) and the WS close codes.
- `lib/storage.ts` — the ONLY place that touches `localStorage`. Reading it throws
  where site data is blocked, and every store reads at module-eval time in the
  root layout's graph, so a direct access there takes the whole app down.
- `lib/report.ts` — client error reporting (see the root CLAUDE.md table for which
  layer catches what). `+error.svelte`, the `<svelte:boundary>` in `+layout.svelte`
  and the inline watchdog in `app.html` are the three user-visible surfaces; they
  share `components/ErrorCard.svelte` (except the watchdog, which can't — it must
  survive the bundle and CSS being broken, so it's hand-rolled ES5).

## Notes

- The nixie theme renders **real 3D tubes** (`nixieScene.ts`, adapted from
  glowbox's example): each numeral's centreline is extruded into wire-cathode
  `TubeGeometry`, the die's value lit + bloomed inside refractive glass. It uses
  `@glowbox/nixie`'s geometry exports and is **dynamic-imported in `onMount`**
  (that package touches `Path2D` at import, which breaks node tests; this also
  keeps three's postprocessing addons out of the main bundle).
- The 3D scene is vanilla three.js (no threlte/r3f). `DiceScene` runs a physics
  tumble, then slerps each die the short way to the nearest orientation showing
  its server-authoritative face. Falls back to numbers if WebGL is unavailable.
- Navigation must use `resolve()` (`svelte/no-navigation-without-resolve`).
- Icons: edit `static/favicon.svg` / `static/icon-maskable.svg`, then
  `just icons` (librsvg + imagemagick) to regenerate the committed PNGs.
