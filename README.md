# dice

A realtime, no-auth, multiplayer dice roller. The first visitor creates a game
and shares a short code / QR; everyone else joins the same live session and rolls
in **turns**. Rolls stream to every screen and are kept in a running history for
the game's lifetime. Games auto-expire when idle — a dead code just 404s.

- 🎲 **Realistic 3D dice** — three.js + cannon-es physics; ivory / obsidian /
  ruby / emerald / gold materials, plus **nixie tube** dice via
  [`@glowbox`](https://github.com/eetu/glowbox).
- 🔊 **On-device sound** — dice clacks synthesized with the Web Audio API.
- 📱 **Throw it** — flick with the mouse on desktop, shake the phone on mobile
  (DeviceMotion), or just tap.
- 🎨 Light / dark / auto UI theme; room-wide dice theme.
- 🧩 Drag to reorder the turn order; change the number of dice live.

## Stack

Rust **axum** backend (in-memory game rooms + one WebSocket per game, no DB)
embedding a **SvelteKit** SPA. Shipped as a single arm64 container. See
[`CLAUDE.md`](./CLAUDE.md) for the architecture and invariants.

## Develop

```sh
just dev        # backend on :3040 (bacon), SPA on :5173 (vite, proxied)
```

Open two browser windows, create a game in one, join with the code in the other.

```sh
just check      # clippy + rustfmt + yarn validate
just test       # cargo + vitest
just build      # SPA → dist/, then the release binary
```

Requires Rust, Node (see `frontend/.node-version`), `just`, and `bacon`.

## Configure (backend env)

| Var                    | Default        | Meaning                                                       |
| ---------------------- | -------------- | ------------------------------------------------------------ |
| `DICE_BIND`            | `0.0.0.0:3040` | Listen address                                               |
| `DICE_TTL_SECS`        | `7200`         | Idle lifetime of a game before reap (≥ 1)                    |
| `DICE_MAX`             | `8`            | Max dice per roll                                            |
| `DICE_MAX_ROOMS`       | `5000`         | Max concurrent game rooms (bounds memory)                   |
| `DICE_MAX_PLAYERS`     | `16`           | Max players per room                                         |
| `STATIC_DIR`           | `./dist`       | Built SPA to serve (prod)                                    |
| `DICE_TRUST_PROXY`     | `false`        | Trust `X-Forwarded-For`/`X-Real-IP` for per-IP limits — see below |
| `DICE_RL_CREATE_PER_MIN` | `10`         | Per-IP room creations / minute (also the burst)             |
| `DICE_RL_JOIN_PER_MIN` | `60`           | Per-IP joins / minute (also the burst)                      |
| `DICE_WS_PER_IP`       | `24`           | Max concurrent WebSockets per IP                            |
| `DICE_MAX_WS`          | `20000`        | Global cap on concurrent WebSockets                        |
| `DICE_WS_MSGS_PER_SEC` | `20`           | Per-connection inbound message budget / sec (burst 2×)      |
| `DICE_STATE_FILE`      | _(unset)_      | Path to persist games across a graceful restart — see below |

### Surviving a restart (optional)

By default a restart drops every game (in-memory, ephemeral). Set
`DICE_STATE_FILE` to a writable path and, on a **graceful** shutdown
(SIGTERM/SIGINT — what a deploy or reboot sends), the live games are flushed to
that JSON file and reloaded (then the file is consumed) on the next boot;
reconnecting clients re-authenticate with their stored token and resume. Notes:

- **Graceful only** — a hard crash / OOM-kill / power loss loses everything
  (there is no periodic checkpoint).
- **The file holds secret player tokens** (that's what lets clients resume). It's
  written `0600`; keep it on a non-public path. In a container the path must be a
  mounted volume — the container filesystem is replaced on each deploy.
- Version-tagged: a file written by an incompatible older build is discarded
  (those games are lost) rather than mis-read.

### Abuse protection (public endpoint)

`dice` is un-authed, so it self-limits per client IP: a token bucket on room
creation + join (returns **429**), a per-IP + global cap on concurrent
WebSockets, a per-connection message budget (kills broadcast amplification), and
a 16 KiB request-body cap (**413**). Room / player / dice / TTL caps above bound
total memory. These are defense-in-depth — a real DDoS is still the edge's job.

**`DICE_TRUST_PROXY` is the load-bearing switch.** Per-IP limits key on the
client IP, which the app can only see correctly if it knows whether a proxy is in
front:

- **Behind a reverse proxy** (TLS terminator / Traefik / nginx): set
  `DICE_TRUST_PROXY=true`. Otherwise every request looks like it comes from the
  proxy and all clients share one bucket (self-DoS). The proxy **must** set
  `X-Real-IP` / append `X-Forwarded-For` (Traefik and nginx do by default).
- **Directly exposed** (no proxy): leave it `false`. Trusting the header when
  anyone can set it lets a client forge its IP to dodge the limits.

Per-IP defaults are deliberately NAT-friendly (a venue full of phones can share
one public IP) — raise `DICE_WS_PER_IP` / `DICE_RL_JOIN_PER_MIN` for a large
shared-network crowd, lower them to tighten a hostile-facing deploy.

## Deploy

`dice` ships as a **single `linux/arm64` container** (`Dockerfile` → `scratch`):
the binary serves the embedded SPA _and_ the API + WebSocket from **one origin**,
so a deploy just runs the image and routes to it. Deployment-agnostic contract:

- **Image:** `ghcr.io/eetu/dice` — CI publishes `:main` on every push to `main`,
  and `:<version>` + `:latest` on a `v*` git tag.
- **Port:** `3040` (change with `DICE_BIND`).
- **Health:** `GET /status` → `{ service, version, rooms }`, unauthenticated —
  use it for liveness probes.
- **Public / un-gated:** no login, no forward-auth — anyone with a room code
  joins (see `SECURITY.md`). Terminate TLS at the edge, but do **not** put it
  behind an auth proxy.
- **Stateless:** all state is in memory — no database, no volumes, nothing to
  back up. A restart drops every game (by design).
- **Behind a reverse proxy:** set `DICE_BIND=127.0.0.1:3040` so the proxy is the
  only public listener, and **`DICE_TRUST_PROXY=true`** so per-IP limits see the
  real client (see _Abuse protection_). `/ws` is same-origin, so a normal HTTP
  proxy that forwards WebSocket upgrades needs no special config.

Run it directly:

```sh
docker run -p 3040:3040 ghcr.io/eetu/dice:main   # → http://localhost:3040
```
