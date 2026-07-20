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
  abuse itself (`backend/src/guard.rs`): per-IP token buckets on create/join
  (429), per-IP + global concurrent-WS caps (429), a per-connection message
  budget (drops broadcast-amplification floods, closes sustained ones), and a
  16 KiB body cap (413) — on top of the room/player/dice/history/TTL memory
  bounds. **`DICE_TRUST_PROXY` is load-bearing:** per-IP keys off the real client
  IP, read from `X-Forwarded-For`/`X-Real-IP` ONLY when a trusted proxy is in
  front, else the TCP peer. Wrong setting = self-DoS (proxy, trust off) or
  forgeable limits (no proxy, trust on). Serving uses
  `into_make_service_with_connect_info::<SocketAddr>()` so handlers see the peer.
- **In-memory + ephemeral.** No database. All game state lives in
  `Arc<Mutex<HashMap<Code, Arc<Mutex<Room>>>>>`. A background reaper drops rooms
  idle past `DICE_TTL_SECS` (default 2h); their code then 404s. A server restart
  loses all games — by design.
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
  `liars` (Liar's Dice — hidden per-player dice, personalized `liars` view),
  `yatzy` (Nordic Yatzy — public dice, up to 3 rolls/turn with holds, 15-box
  scorecard, scoring in `room::yatzy_score_cat`). The host picks the game in the
  lobby (create takes an optional `mode`) or via Settings (`setMode`). A `setMode`
  or a join to a **pristine** (not-yet-started) match (re)deals with everyone
  present (`on_player_joined`); joining a match already in progress spectates.
- **WS protocol** (`backend/src/room.rs`): server→client `sync` / `rolled` /
  `presence` / `liarsChanged`(internal) / `liars` / `yatzy`; client→server `roll`
  / `reorder` / `setDiceCount` / `setName` / `setDiceTheme` / `setDeck` /
  `skipTurn` / `setMode` / `bid` / `callLiar` / `nextRound` / `yatzyRoll` /
  `yatzyHold` / `yatzyScore` / `leave`. Liar's dice are hidden — the server
  broadcasts a `liarsChanged` ping and each socket rebuilds its own `liars` view;
  Yatzy is public so its `yatzy` view is broadcast verbatim. All fields camelCase;
  TS mirror in `frontend/src/lib/api.ts` — keep the two in sync by hand (no codegen).
- **Dice theme is room-wide** (`setDiceTheme`, in the snapshot); UI light/dark is
  a personal `data-theme` preference. `nixie` theme renders glowbox tubes instead
  of the 3D mesh.

## Working on this repo

- `just dev` → backend on `:3040` (bacon, hot-reload), SPA on `:5173` (proxies
  `/api`, `/status`, `/ws` → `:3040`). Open two browsers to test multiplayer.
- Config (backend, via `backend/.env`): `DICE_BIND` (`0.0.0.0:3040`),
  `DICE_TTL_SECS` (7200, min 1), `DICE_MAX` (8), `DICE_MAX_ROOMS` (5000),
  `DICE_MAX_PLAYERS` (16), `STATIC_DIR` (`./dist`, prod only). Caps bound memory
  on the public endpoint (`/api/games` → 503 when full, join → 409). Abuse
  guards: `DICE_TRUST_PROXY` (false), `DICE_RL_CREATE_PER_MIN` (10),
  `DICE_RL_JOIN_PER_MIN` (60), `DICE_WS_PER_IP` (24), `DICE_MAX_WS` (20000),
  `DICE_WS_MSGS_PER_SEC` (20). Full env table + the trust-proxy rule in
  `README.md`; rationale in `SECURITY.md`.
- `just check` = clippy + rustfmt + `yarn validate`. `just test` = cargo + vitest.
- Prod: the binary serves `dist/` with an SPA fallback; one origin, port 3040.

## Out of scope

- No accounts, no login, no persistence across restarts.
- No server-side physics — the backend only decides result values; all rendering
  and physics are client-side.
- No spectator-only mode; everyone who joins is a player.
