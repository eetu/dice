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
    # Build + assert the bundle stays inside the declared browser floor: a
    # dependency needing newer syntax than build.target used to sail through and
    # break older Android browsers on the game route only.
    cd frontend && {{yarn}} build && {{yarn}} check:bundle

# Run all tests (rust unit/integration + frontend).
test:
    cargo test --workspace
    cd frontend && {{yarn}} test

# Regenerate PWA icons from the source SVGs (needs librsvg + imagemagick).
icons:
    cd frontend && bash scripts/gen-icons.sh

# Cut a release: bump the version EVERYWHERE (Cargo workspace + frontend
# package.json + Cargo.lock), roll CHANGELOG.md's [Unreleased] into the new
# version, commit, tag vX.Y.Z, push, and publish the GitHub release (notes =
# that changelog section). The tag build then publishes ghcr images X.Y.Z plus
# the rolling X.Y / X / latest aliases. Refuses on a dirty tree, off main, or
# with an empty [Unreleased] section.
release level:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{justfile_directory()}}"
    case "{{level}}" in patch|minor|major) ;; *) echo "usage: just release (patch|minor|major)"; exit 1 ;; esac
    command -v cargo-set-version >/dev/null || { echo "release: needs cargo-edit (cargo install cargo-edit)"; exit 1; }
    [ "$(git branch --show-current)" = "main" ] || { echo "release: not on main"; exit 1; }
    [ -z "$(git status --porcelain)" ] || { echo "release: working tree not clean"; exit 1; }
    git pull --ff-only >/dev/null
    # Release notes = the [Unreleased] section (must actually say something).
    notes=$(awk '/^## \[Unreleased\]/{f=1; next} /^## \[/{f=0} f' CHANGELOG.md | grep -v '^<!--' | sed -e '/^[[:space:]]*$/d' || true)
    [ -n "$notes" ] || { echo "release: CHANGELOG.md has nothing under [Unreleased]"; exit 1; }
    # Native version bumps: cargo-edit computes + writes the workspace version
    # (TOML-aware), then yarn applies the exact same number to package.json.
    cargo set-version --workspace --bump "{{level}}"
    new=$(awk -F'"' '/^version = /{print $2; exit}' Cargo.toml)
    ( cd frontend && {{yarn}} version "$new" )
    cargo check --quiet   # make sure Cargo.lock carries the new version
    echo "release: -> $new"
    perl -0pi -e "s/\n<!-- Add changes here as they land. -->\n//g" CHANGELOG.md
    perl -0pi -e "s/^## \[Unreleased\]\n/## [Unreleased]\n\n<!-- Add changes here as they land. -->\n\n## [$new] - $(date +%Y-%m-%d)\n/m" CHANGELOG.md
    git add Cargo.toml Cargo.lock frontend/package.json CHANGELOG.md
    git commit -m "chore(release): v$new"
    git tag -a "v$new" -m "dice $new"
    git push
    git push origin "v$new"
    gh release create "v$new" --title "dice v$new" --notes "$notes"
    echo "release: v$new published — the tag build rolls the ghcr aliases"
