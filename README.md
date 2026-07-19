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

| Var                | Default        | Meaning                                   |
| ------------------ | -------------- | ----------------------------------------- |
| `DICE_BIND`        | `0.0.0.0:3040` | Listen address                            |
| `DICE_TTL_SECS`    | `7200`         | Idle lifetime of a game before reap (≥ 1) |
| `DICE_MAX`         | `8`            | Max dice per roll                         |
| `DICE_MAX_ROOMS`   | `5000`         | Max concurrent game rooms (bounds memory) |
| `DICE_MAX_PLAYERS` | `16`           | Max players per room                      |
| `STATIC_DIR`       | `./dist`       | Built SPA to serve (prod)                 |

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
  only public listener. `/ws` is same-origin, so a normal HTTP proxy that
  forwards WebSocket upgrades needs no special config.

Run it directly:

```sh
docker run -p 3040:3040 ghcr.io/eetu/dice:main   # → http://localhost:3040
```
