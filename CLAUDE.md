# dice — repo overview

Realtime, no-auth, multiplayer dice roller in the homebrew family. First visitor
creates a game and shares a short code / QR; others join the same live session
and roll in turns. Rust axum backend embeds a SvelteKit SPA; realistic 3D dice
(three.js + cannon-es) and "nixie tube" dice (via the sibling `@glowbox/*`
library). Siblings: [rust-axum], [spa-frontend], [halo-design], `../glowbox`.

## Layout

```
backend/    Rust axum: in-memory game rooms, REST + one WebSocket per game, TTL reaper
frontend/   SvelteKit SPA (adapter-static → dist/), 3D + nixie dice, stores, halo tokens
Dockerfile  xx cross-compile → scratch (single image)
justfile    `just dev` runs backend (bacon) + frontend (vite) together
```

## Conventions (load-bearing invariants)

- **No auth, public app.** There is NO oauth2-proxy gating and NO forward-auth
  extractor — anyone with the code joins. Deploy un-gated (see raspi wiring).
- **Self-defending public endpoint.** Since it's un-authed, the backend caps
  abuse itself (`backend/src/guard.rs`): per-IP token buckets on
  create/join/client-error
  (429), per-IP + global concurrent-WS caps (429), a per-connection message
  budget (drops broadcast-amplification floods, closes sustained ones), and a
  16 KiB body cap (413) — on top of the room/player/dice/history/TTL memory
  bounds. **`DICE_TRUST_PROXY` is load-bearing:** per-IP keys off the real client
  IP, read from `X-Forwarded-For`/`X-Real-IP` ONLY when a trusted proxy is in
  front, else the TCP peer. Wrong setting = self-DoS (proxy, trust off) or
  forgeable limits (no proxy, trust on). Serving uses
  `into_make_service_with_connect_info::<SocketAddr>()` so handlers see the peer.
- **In-memory, ephemeral by default.** No database. All game state lives in
  `Arc<Mutex<HashMap<Code, Arc<Mutex<Room>>>>>`. A hard crash loses all games.
- **A room outlives its players' attention.** Three ways one ends, and the
  distinction matters because an invite link already shared dies with it:
  1. the last HUMAN explicitly leaves → destroyed at once (`ws.rs`, `leave` only —
     a dropped socket does NOT count), freeing the code;
  2. idle past `DICE_TTL_SECS` → the reaper drops it (prod runs **24h**: a link
     shared in the evening must still work the next day, and a 1h TTL was the
     single biggest source of "the link didn't work");
  3. at `DICE_MAX_ROOMS`, a create evicts the least-recently-active room **with
     nobody connected** rather than 503-ing (`routes::evict_stalest_idle`). This
     is load-bearing with a long TTL: a closed tab never sends `leave`, so the
     table fills with abandoned games and a plain 503 would block ALL new games
     for hours. A room someone is connected to is never evicted — if every room
     is occupied, the create genuinely fails (503). **Optional graceful-restart persistence** (`backend/src/persist.rs`,
  opt-in via `DICE_STATE_FILE`): on SIGTERM/SIGINT the rooms are flushed to one
  JSON file and reloaded (then the file is consumed) on the next boot, so a
  deploy/reboot resumes instead of dropping games. The client's WS auto-reconnect
  + stored creds do the rest. **The file holds secret player tokens** (needed so a
  reconnecting client re-authenticates) — written `0600`, must live on a
  per-restart-persistent, non-public path. Flush is graceful-only (no periodic
  checkpoint); a crash/OOM still drops everything.
- **Server is the roll authority.** Only the current player may `roll`; the
  backend generates the face values with `rand` and broadcasts them. Each client
  animates its own physics tumble that settles to those values (no cross-client
  determinism needed). History always uses the server values.
- **Player identity = secret token.** `POST /api/games` / `.../join` return
  `{ code, playerId, token }`. The `token` authenticates the WS + actions and is
  NEVER serialized in snapshots (`#[serde(skip)]`); `playerId` is the public id.
- **Turn order == player list order.** Drag-reorder sends `reorder`; the turn
  pointer follows the same player. `advance_turn` moves to the next player in
  order and does NOT skip disconnected players — the game *waits* for a dropped
  player (phone standby, flaky wifi). `skipTurn` is the manual override to move
  past someone genuinely gone. The client also holds a screen wake lock while the
  game is foregrounded so a slow round doesn't sleep the device (and drop them).
- **Built-in games** (`mode`, room-wide): `free` (the plain turn-based roller),
  `liars` (Liar's Dice — hidden per-player dice, personalized `liars` view;
  **needs ≥2 seats**: `LiarsState::playable` gates `bid`/`callLiar` and the
  last-player-standing win, because one seat satisfies elimination trivially — a
  solo player calling their own bluff used to end the match and win it. Yatzy and
  Farkle are fine solo),
  `yatzy` (Nordic Yatzy — public dice, up to 3 rolls/turn with holds, 15-box
  scorecard, scoring in `room::yatzy_score_cat`), `farkle` (push-your-luck — set
  aside scoring dice or bust, scoring in `room::farkle_score_exact`; first to
  10 000 wins; the client mirrors the scorer in `frontend/src/lib/games/farkle.ts`
  for live preview, backend is authoritative). The host picks the game in the
  lobby (create takes an optional `mode`) or via Settings (`setMode`). A `setMode`
  or a join to a **pristine** (not-yet-started) match (re)deals with everyone
  present (`on_player_joined`); joining a match already in progress spectates.
- **Bots are server-side players** (`backend/src/bot.rs`). `addBot { skill }` /
  `removeBot` (anyone in the room may — peer-equal, no host). The wire shows
  only `bot: true`; the SKILL (easy/hard/cheater) is `#[serde(skip)]` like the
  token — whether a bot cheats must never be provable from traffic. A per-room
  "pump" task plays bot turns with jittered delays (`DICE_BOT_DELAY_MS`);
  invariants: `schedule_pump` locks the room, so it must only be called AFTER
  every room-guard scope (std Mutex is not reentrant); bot applies go through
  `apply_untouched` (bots never feed the TTL — only humans keep a room alive);
  bots pause while no human is connected; destroy-on-empty counts HUMANS
  (`human_count`), so a bots-only room frees its code. The cheater is *sneaky*:
  best-of-2 biased rolls at the four roll sites + perfect information in
  Liar's, camouflaged so no single action is provably unfair.
- **WS protocol** (`backend/src/room.rs`): server→client `sync` / `rolled` /
  `presence` / `liarsChanged`(internal) / `liars` / `yatzy` / `farkle`;
  client→server `roll` / `reorder` / `setDiceCount` / `setName` / `setDiceTheme` /
  `setDeck` / `skipTurn` / `setMode` / `bid` / `callLiar` / `nextRound` /
  `yatzyRoll` / `yatzyHold` / `yatzyScore` / `farkleRoll` / `farkleSelect` /
  `farkleSetAside` / `farkleBank` / `addBot` / `removeBot` / `leave`. Liar's dice are hidden — the server broadcasts a
  `liarsChanged` ping and each socket rebuilds its own `liars` view; Yatzy + Farkle
  are public so their views broadcast verbatim. All fields camelCase; TS mirror in
  `frontend/src/lib/api.ts` — keep the two in sync by hand (no codegen).
- **Telemetry is standard OTel, metrics + logs, opt-in** (`backend/src/telemetry.rs`):
  active only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (all knobs = standard
  `OTEL_*` vars, nothing DICE-prefixed); unset → a complete no-op. Counters for
  games/joins/rolls/bots/reaps/client-errors + live rooms/sockets gauges, and
  `warn!`/`error!` lines exported as OTLP log records. **No traces.**
- **The frontend reports its own failures** — everything funnels through
  `frontend/src/lib/report.ts` → `POST /api/client-error` (our backend, never the
  collector directly: the browser holds no ingest credential and the backend
  sanitizes first) → `dice.client.errors{kind}` + an OTLP log record. A blank page
  can't describe itself, so the app says what broke instead of leaving "it didn't
  work on my phone" as the only evidence. **No single mechanism catches
  everything** — four layers, because each is blind to the others' failures:

  | Layer | Catches | Kinds |
  |---|---|---|
  | inline watchdog in `app.html` (classic ES5, pre-boot) | bundle won't parse, no ESM, dead chunk, module-eval throw, never-rendered; plus ALL window `error`/`unhandledrejection` (event handlers, async) | `boot` `noEsm` `chunk` `runtime` |
  | `<svelte:boundary>` in `+layout.svelte` | throws during render or inside an `$effect` — invisible to `handleError`; shows `ErrorCard` with a working reset | `render` |
  | `hooks.client.ts` `handleError` | route load / navigation errors (SvelteKit's default would discard the message) | `route` |
  | explicit call sites | join/create refused, socket given up on | `join` `ws` |

  A boundary deliberately does NOT catch event-handler or async errors (Svelte
  doesn't route them through boundaries) — that's why the window-level handlers
  stay. A **404 is the one route error that isn't a crash**: no route matches, so
  the client router lands on `+error.svelte` with status 404 (the backend serves
  the shell for every path, so there's no server 404 page to hit). It branches to
  a plain "Nothing here" card — no diagnostics, no Reload, nothing reported —
  because a mistyped invite link is not something the user should relay to us. `kind` is a CLOSED enum mirrored in `backend/src/routes.rs` (it's a metric
  attribute, so cardinality must be bounded); message/url/UA are sanitized +
  truncated server-side; the endpoint is per-IP rate limited
  (`DICE_RL_CLIENT_ERR_PER_MIN`) with a 1 KiB body cap, since it's an un-authed
  write. At most one report per kind per page load, so a reload loop can't flood.
- **Nothing the game doesn't need may crash it.** The 3D engine (three.js +
  cannon-es) is dynamic-imported and falls back to numeric dice on a parse
  failure, a missing chunk, no WebGL, or a lost GPU context; `frontend/src/lib/storage.ts`
  wraps ALL persistence because reading `localStorage` *throws* where site data
  is blocked (`typeof` is not a guard) and every store reads at module-eval time
  in the root layout's graph — one throw there used to render an empty `<body>`.
  `vite.config.ts` pins `build.target` so a dependency can't silently raise the
  browser floor (Vite's default excluded Samsung Internet and older WebViews).
- **Dice theme is room-wide** (`setDiceTheme`, in the snapshot); UI light/dark is
  a personal `data-theme` preference. `nixie` theme renders glowbox tubes instead
  of the 3D mesh.

## Working on this repo

- `just dev` → backend on `:3040` (bacon, hot-reload), SPA on `:5173` (proxies
  `/api`, `/status`, `/ws` → `:3040`). Open two browsers to test multiplayer.
- Config (backend, via `backend/.env`): `DICE_BIND` (`0.0.0.0:3040`),
  `DICE_TTL_SECS` (7200 default, min 1; prod 86400), `DICE_MAX` (8),
  `DICE_MAX_ROOMS` (5000),
  `DICE_MAX_PLAYERS` (16), `STATIC_DIR` (`./dist`, prod only), `DICE_STATE_FILE`
  (unset → ephemeral; a path → persist games across a graceful restart). Caps bound memory
  on the public endpoint (`/api/games` → 503 only when every room is occupied,
  else it evicts the stalest idle one; join → 409). Abuse
  guards: `DICE_TRUST_PROXY` (false), `DICE_RL_CREATE_PER_MIN` (10),
  `DICE_RL_JOIN_PER_MIN` (60), `DICE_RL_CLIENT_ERR_PER_MIN` (6),
  `DICE_WS_PER_IP` (24), `DICE_MAX_WS` (20000),
  `DICE_WS_MSGS_PER_SEC` (20). Full env table + the trust-proxy rule in
  `README.md`; rationale in `SECURITY.md`.
- `just check` = clippy + rustfmt + `yarn validate` + a built-bundle syntax-floor
  assertion. `just test` = cargo + vitest. (e2e is `cd frontend && yarn e2e`; the
  spawned-binary Rust tests are `cargo test -p dice-integration -- --ignored`.)
- **`main` requires a PR + a passing `ci-gate`** (a repo ruleset — note the
  *legacy* branch-protection API reports "not protected", so check rulesets, not
  that). An admin can bypass it, but bypassing skips the check that gates the
  release, so don't.
- **Changelog + releases** — two steps, because of the above:
  1. add user-visible changes to `CHANGELOG.md` under `[Unreleased]` as they land;
  2. `just release (patch|minor|major)` bumps the version everywhere (Cargo
     workspace + `frontend/package.json` + lockfile), rolls the changelog onto a
     `release/vX.Y.Z` branch, and opens its PR. It tags nothing;
  3. merge that PR, then `just release-publish` tags the MERGED commit, pushes the
     tag (the tag build publishes ghcr `X.Y.Z` + the rolling `X.Y` / `X` /
     `latest` aliases) and publishes the GitHub release from that version's
     changelog section. It refuses if the version is already tagged, if the
     changelog has no section for it, or if any check on `main` failed.

  The tag has to come after the merge: tagging the branch would point the release
  at a commit that never reaches `main` (and vanishes on a squash merge).
- The deployed host pulls `ghcr.io/eetu/dice:1` via `io.containers.autoupdate`, on
  a daily `podman-auto-update.timer` — a release is live within ~24h, or
  immediately with `ssh invinite.tech 'sudo podman auto-update'`.
- Prod: the binary serves `dist/` with an SPA fallback; one origin, port 3040.

## Out of scope

- No accounts, no login, no persistence across restarts.
- No server-side physics — the backend only decides result values; all rendering
  and physics are client-side.
- No spectator-only mode; everyone who joins is a player.
