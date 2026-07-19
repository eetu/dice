# backend — dice (Rust axum)

In-memory game rooms + realtime WebSocket fan-out. No DB. See the root CLAUDE.md
for the cross-cutting invariants (auth model, roll authority, token secrecy).

## Modules

- `lib.rs` — boot flow (dotenv → tracing → `Config` → `AppState` → router →
  serve) + the TTL `reap_loop`.
- `config.rs` — `Config::from_env` (`DICE_BIND`, `STATIC_DIR`, `DICE_TTL_SECS`,
  `DICE_MAX`). Public app → no `dev_auth`.
- `room.rs` — the heart: `Room` (players, turn, dice, history, per-room
  `broadcast::Sender`), join-code gen, `apply(actor_id, ClientMsg)`, and the
  `ServerMsg` / `ClientMsg` / `Snapshot` wire types. Unit-tested (turn advance,
  roll validation, reorder permutation guard, leave).
- `routes.rs` — router + REST (`POST /api/games`, `POST /api/games/{code}/join`,
  `GET /api/games/{code}`, `GET /status`), CSP layer, path-traversal-safe SPA
  fallback.
- `ws.rs` — `/ws/games/{code}?token=…`; `tokio::select!` loop. IMPORTANT: never
  hold the room `MutexGuard` across an `.await` (makes the future !Send) — read
  owned data under the lock, then await.

## Notes

- Codes are Crockford-ish base32 (no 0/O/1/I/L/U), 5 chars, case-insensitive on
  input (upper-cased server-side).
- `broadcast::Sender::send` erroring (no subscribers) is expected and ignored.
- CSP `script-src` includes `'unsafe-inline'` — SvelteKit's static build emits an
  inline bootstrap `<script>` with no stable hash across bumps, and the app
  renders no user HTML (Svelte escapes everything, no `{@html}`). three.js +
  cannon-es are plain JS (no wasm), so no `'wasm-unsafe-eval'`. The e2e golden
  path (`frontend/e2e`) is the guard that the SPA still boots under this CSP.
