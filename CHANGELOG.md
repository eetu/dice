# Changelog

Notable, user-visible changes. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow semver. Add entries under **[Unreleased]** as changes land —
`just release (patch|minor|major)` rolls that section into the next version
(and refuses to cut a release while it's empty).

## [Unreleased]

### Fixes

- The win screen's glow is a clean centered spotlight (pure CSS) — the old
  drifting blob wash read as a pointer glint stuck over the dark backdrop on
  desktop, and cost a second canvas layer.
- The ambient dice backdrop no longer freezes with a stale pointer glint baked
  into the frame when entering a game (interactivity now drops and the frame
  repaints glint-free on freeze).

## [1.0.1] - 2026-07-24

### Improvements

- Material tray surfaces: oak/walnut woodgrain, concrete speckle, and brushed
  steel — procedural, seamless, matched to each deck.
- A true recessed tray: the play floor sits sunken in a raised tabletop; the
  front edge is hidden and the pit reads with real depth.
- d100 identification: the percentile pair shows underlined numerals (flat on
  the face, like real percentile sets) — replaces the floating dot markers.
- The app version is shown in the lobby and Settings.

### Fixes

- A d10 wedged against the wall no longer pirouettes forever (rolling-friction
  brake in the settle sim).
- Free-mode bots pace their rolls like humans — they wait out the tumble
  animation instead of speed-running the table.
- Farkle spectators see bot dice selections, a +N bank flash, and a
  third-person bust message.
- The dice-config button icon is readable on mobile and the dark theme.

## [1.0.0] - 2026-07-24

First stable release. Realtime, no-auth multiplayer dice over one shared room
code.

- Four games: the free 3D roller, Liar's Dice, Nordic Yatzy, and Farkle — one
  room, switchable mid-session.
- Full D&D polyset in the free roller: d4–d100 mixed trays with per-die
  materials, true polyhedral physics dice with rounded bodies, and four
  elemental glass dice (fire/water/air/earth) with animated cores.
- Bots: Easy / Hard / Sneaky, seated from the invite panel — server-side
  players with real per-game strategies; the Sneaky one cheats on the backend,
  statistically and deniably.
- Retro 8-bit soundscape, win fireworks with a Course-Clear-homage fanfare, QR
  invites, drag turn order, shake-to-roll, EN/FI.
- Self-defending public endpoint (rate limits, WS caps, message budgets),
  optional graceful-restart persistence, and opt-in OpenTelemetry metrics via
  standard `OTEL_*` envs.
