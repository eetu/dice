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

| Var              | Default          | Meaning                              |
| ---------------- | ---------------- | ------------------------------------ |
| `DICE_BIND`      | `0.0.0.0:3040`   | Listen address                       |
| `DICE_TTL_SECS`  | `7200`           | Idle lifetime of a game before reap  |
| `DICE_MAX`       | `8`              | Max dice per roll                    |
| `STATIC_DIR`     | `./dist`         | Built SPA to serve (prod)            |

## Deploy

Public (un-gated) service — see `SECURITY.md`. Build/push the image from the
`Dockerfile`; wire it into the `../raspi` pyinfra repo as a **non-gated** quadlet
(not in `_gated_hosts`), stateless (no restic paths).
