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
- **WS protocol** (`backend/src/room.rs`): server→client `sync` / `rolled` /
  `presence`; client→server `roll` / `reorder` / `setDiceCount` / `setName` /
  `setDiceTheme` / `setDeck` / `skipTurn` / `leave`. All fields camelCase; TS mirror in
  `frontend/src/lib/api.ts` — keep the two in sync by hand (no codegen).
- **Dice theme is room-wide** (`setDiceTheme`, in the snapshot); UI light/dark is
  a personal `data-theme` preference. `nixie` theme renders glowbox tubes instead
  of the 3D mesh.

## Working on this repo

- `just dev` → backend on `:3040` (bacon, hot-reload), SPA on `:5173` (proxies
  `/api`, `/status`, `/ws` → `:3040`). Open two browsers to test multiplayer.
- Config (backend, via `backend/.env`): `DICE_BIND` (`0.0.0.0:3040`),
  `DICE_TTL_SECS` (7200, min 1), `DICE_MAX` (8), `DICE_MAX_ROOMS` (5000),
  `DICE_MAX_PLAYERS` (16), `STATIC_DIR` (`./dist`, prod only). Caps bound memory
  on the public endpoint (`/api/games` → 503 when full, join → 409).
- `just check` = clippy + rustfmt + `yarn validate`. `just test` = cargo + vitest.
- Prod: the binary serves `dist/` with an SPA fallback; one origin, port 3040.

## Out of scope

- No accounts, no login, no persistence across restarts.
- No server-side physics — the backend only decides result values; all rendering
  and physics are client-side.
- No spectator-only mode; everyone who joins is a player.
