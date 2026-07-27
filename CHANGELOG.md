# Changelog

Notable, user-visible changes. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow semver. Add entries under **[Unreleased]** as changes land —
`just release (patch|minor|major)` rolls that section into the next version
(and refuses to cut a release while it's empty).

## [Unreleased]

<!-- Add changes here as they land. -->

### Fixes

- **An invite link could fail on Android with a blank page and no explanation.**
  Several independent causes, all fixed:
  - The game route pulled the whole 3D engine (three.js + cannon-es) in eagerly,
    and it shipped syntax that Samsung Internet 13/14 and pinned Android WebViews
    (what in-app browsers use) can't parse — so the lobby loaded and the invite
    link died. The engine now loads on demand and the browser floor is pinned
    explicitly, with a build check so a dependency can't quietly raise it again.
  - Browsers set to block site data (Chrome for Android "block all cookies", most
    in-app browsers) crashed the app on startup instead of simply not remembering
    anything. Persistence now degrades to the current tab, and the lobby says so.
  - After a deploy, a browser holding a cached page shell asked for build files
    that no longer existed and got the page back instead of a 404, which it
    refuses to run — a blank screen, sometimes reloading forever. Missing build
    files now 404, the shell is never cached, and the app reloads at most once.
- Dice fall back to plain numbers instead of a dead black area when the device
  drops the 3D context (common on Android under memory pressure) or can't load
  the engine.
- Pinch-zoom works again on Android (it was disabled by a viewport setting that
  only ever affected Android).
- Joining a game whose code had been recycled no longer dead-ends on "this game
  expired" — you're rejoined as a new player, and told why.
- **Liar's Dice no longer ends instantly when you're the only player.** Bidding
  and then calling your own bluff finished the match on the spot and declared you
  the winner (one seat trivially satisfies "last player standing"). A solo table
  now waits for an opponent and says so; the match deals as soon as someone joins.

### Improvements

- Failures now say what actually happened. A full game, a busy server, a rate
  limit, no network, a timeout and a refused connection each get their own
  message plus the server's own words, instead of one "something went wrong" —
  and connecting can no longer hang forever or retry invisibly.
- If something breaks, you now get a copyable panel with the error, the build and
  the browser, so a bug report can carry something useful — whether the app failed
  to start at all, hit an error while drawing the screen (which used to leave a
  half-dead page), or failed to load a route. Failures also report themselves to
  the server's telemetry, which now exports logs as well as metrics.

## [1.0.2] - 2026-07-24

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
