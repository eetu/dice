# dice task runner. `just` with no args lists recipes.
# Yarn = the repo-vendored release (yarnPath in frontend/.yarnrc.yml), run via
# node — no global yarn / corepack needed, and it auto-tracks `yarn set version`.
yarn := "node " + justfile_directory() / "frontend" / `awk '/^yarnPath:/{print $2}' frontend/.yarnrc.yml`

default:
    @just --list

# Install frontend deps.
install:
    cd frontend && {{yarn}} install

# Dev the whole app: Rust backend (bacon, headless) + SvelteKit (vite), one
# Ctrl-C tears both down (children + grandchildren; never `kill 0`, which would
# also signal `just`). Backend :3040, frontend :5173 (proxies /api,/status,/ws).
# Add a `host` arg (`just dev host`) to expose the frontend on the LAN over
# HTTPS + print the network URL/QR, so a phone/tablet can connect — needed to
# test shake-to-roll (iOS gates DeviceMotion to secure contexts).
dev host="":
    #!/usr/bin/env bash
    set -euo pipefail
    pids=""
    cleanup() {
        trap - INT TERM EXIT
        for p in $pids; do
            pkill -P "$p" 2>/dev/null || true
            kill "$p" 2>/dev/null || true
        done
    }
    trap cleanup INT TERM EXIT
    ( cd backend && exec bacon --headless -j run ) &
    pids="$pids $!"
    ( cd frontend && DEV_HOST="{{host}}" exec {{yarn}} dev ) &
    pids="$pids $!"
    wait

# Build the SPA then the release binary.
build:
    cd frontend && {{yarn}} build
    cargo build --release

# Lint + format + typecheck everything (what the pre-commit hook runs).
check:
    cargo clippy --workspace --all-targets -- -D warnings
    cargo fmt --all -- --check
    cd frontend && {{yarn}} validate

# Run all tests (rust unit/integration + frontend).
test:
    cargo test --workspace
    cd frontend && {{yarn}} test

# Regenerate PWA icons from the source SVGs (needs librsvg + imagemagick).
icons:
    cd frontend && bash scripts/gen-icons.sh
