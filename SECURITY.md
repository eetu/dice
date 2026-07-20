# Security

dice is a self-hosted, **intentionally public, no-auth** party app: anyone who
can reach it can create a game, and anyone with a game's short code can join it.
The threat model is deliberately small — there are no accounts, no personal data,
and nothing to protect but the fun. It must not become a foothold (no RCE, no
path traversal, no secret leakage) and must degrade gracefully under abuse.

## Trust boundaries

- **No edge auth.** Unlike most family apps, dice is **not** behind oauth2-proxy
  forward-auth and has no `X-Auth-Request-*` gate — that's the whole point (guests
  join without logging in). Deploy it un-gated (not in raspi's `_gated_hosts`).
- **Per-game secret token.** Create/join return a `token` that authenticates the
  WebSocket and every action. It's never serialized into snapshots
  (`#[serde(skip)]`), so it isn't leaked to other players; only the public
  `playerId` is. Guessing another player's token (UUID v4) is infeasible.
- **CSP.** The backend sets `default-src 'self'` with `script-src 'self'
  'unsafe-inline'`, `img-src 'self' data: blob:` (canvas dice textures + QR data
  URLs), and `connect-src 'self'` (same-origin WebSocket). Fonts are self-hosted
  (`font-src 'self'`), so the app makes **no third-party requests** at runtime.
  `'unsafe-inline'` is
  required for SvelteKit's inline bootstrap script (no stable hash across
  bumps); it's an accepted, low-risk trade-off here because the app renders **no
  user-supplied HTML** (Svelte auto-escapes every interpolation; there is no
  `{@html}`), so there's no injection sink to exploit. No `unsafe-eval` /
  `wasm-*` (three.js + cannon-es are plain JS). `frame-ancestors 'none'`,
  `object-src 'none'`.
- **No database, no filesystem writes from input.** Game state is in memory only.
  The only path built from a request is the SPA static path, which is
  canonicalized and checked to stay under `STATIC_DIR` (no `..` escape).

## Abuse / DoS resistance

Because the endpoint is un-authed and public, the backend self-limits so one
source can't deny the service to everyone (defense-in-depth — a distributed DDoS
is still the edge's job):

- **Per-IP rate limits** — a token bucket on `POST /api/games` (default 10/min)
  and `.../join` (60/min); over budget → **429**. This is the main defense
  against one client filling `DICE_MAX_ROOMS` and 503-ing the whole service.
- **WebSocket caps** — per-IP (`DICE_WS_PER_IP`, default 24) and global
  (`DICE_MAX_WS`, 20000) concurrent-connection limits; over the cap the handshake
  is refused with **429**. A per-connection inbound-message budget
  (`DICE_WS_MSGS_PER_SEC`, 20) drops floods and closes a socket that sustains
  them — neutralizing the broadcast amplification where one client message fans a
  snapshot to the whole room. WS frames are capped at 16 KiB.
- **Body + memory caps** — request bodies are capped at 16 KiB (**413**), and
  rooms / players / dice / history / TTL are all bounded, so total memory has a
  ceiling regardless of traffic.
- **Client-IP trust** — per-IP limits key on the real client IP. `DICE_TRUST_PROXY`
  gates whether `X-Forwarded-For` / `X-Real-IP` are believed: **on** behind a
  trusted proxy (else all clients collapse into one bucket), **off** when directly
  exposed (else the header is forgeable to dodge limits). See `README.md`.

## Secrets

There are none to inject — dice has no API keys, DB, or upstreams. `.env` (local
bind/TTL config only) is gitignored. Containers run as a non-root UID (1000).

## Accepted risks

- **Room-code guessing.** Codes are 5 chars of a 30-symbol alphabet (~24M
  combos). With few live rooms and a TTL, blindly guessing an active game is
  impractical — and the payoff is joining a dice game. Accepted; revisit only if
  games ever hold anything sensitive.
- **Distributed abuse.** Per-IP limits + global caps (above) stop a single source
  from exhausting memory or connections, but a large botnet spread across many IPs
  can still fill `DICE_MAX_ROOMS` / `DICE_MAX_WS` up to their ceilings (the app
  degrades to 503/429, it doesn't fall over). Defending against a real distributed
  DDoS is the edge's job (Traefik rate-limit / in-flight-req middleware, upstream
  scrubbing) — the in-app guards are the floor, not the whole story.

## Out of scope

- Multi-tenant hardening, moderation, or defenses against a determined hostile
  user in your own game (it's a casual party app).
- Persistence, audit logs, or abuse forensics.

## Reporting

Personal project — flag issues privately to the maintainer rather than opening a
public issue with exploit detail.
