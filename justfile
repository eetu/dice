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

# Regenerate the link-preview image (static/og.png) by shooting the live lobby
# sign. Builds first, since it serves dist/. Needs the playwright chromium.
og:
    cd frontend && {{yarn}} build && node scripts/gen-og.mjs

# Releasing is TWO steps, because `main` requires a pull request and a passing
# `ci-gate` (a repo ruleset). Pushing the release commit straight to main only
# ever worked as an admin bypass, which skips the very check that should gate a
# release:
#
#   1. `just release (patch|minor|major)` — prepare on a branch, open the PR.
#   2. merge the PR, then `just release-publish` — tag the merged commit and
#      publish the GitHub release.
#
# The tag must come AFTER the merge: tagging the branch would point the release at
# a commit that never lands on main (and disappears entirely on a squash merge),
# and it's the tag that triggers the image build.

# Bumps the version EVERYWHERE (Cargo workspace + frontend package.json +
# Cargo.lock) and rolls CHANGELOG.md's [Unreleased] into the new version, on a
# `release/vX.Y.Z` branch. Refuses on a dirty tree, off main, or with an empty
# [Unreleased] section. Tags and publishes NOTHING — that's `release-publish`.
# (The line just below is what `just --list` shows.)
# Release step 1: bump + roll the changelog on a branch, open its PR.
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
    # Work out the next version WITHOUT writing it, so the branch exists before
    # anything changes and a failure can't leave main dirty.
    new=$(cargo set-version --workspace --bump "{{level}}" --dry-run 2>&1 | sed -n 's/^ *Upgrading workspace version from .* to \([0-9][0-9.]*\)$/\1/p' | head -1)
    [ -n "$new" ] || { echo "release: could not work out the next version"; exit 1; }
    branch="release/v$new"
    ! git rev-parse --verify --quiet "$branch" >/dev/null || { echo "release: branch $branch already exists"; exit 1; }
    ! git rev-parse --verify --quiet "v$new" >/dev/null || { echo "release: tag v$new already exists"; exit 1; }
    git switch -q -c "$branch"
    # Native version bumps: cargo-edit computes + writes the workspace version
    # (TOML-aware), then yarn applies the exact same number to package.json.
    cargo set-version --workspace --bump "{{level}}"
    ( cd frontend && {{yarn}} version "$new" )
    cargo check --quiet   # make sure Cargo.lock carries the new version
    perl -0pi -e "s/\n<!-- Add changes here as they land. -->\n//g" CHANGELOG.md
    perl -0pi -e "s/^## \[Unreleased\]\n/## [Unreleased]\n\n<!-- Add changes here as they land. -->\n\n## [$new] - $(date +%Y-%m-%d)\n/m" CHANGELOG.md
    git add Cargo.toml Cargo.lock frontend/package.json CHANGELOG.md
    git commit -q -m "chore(release): v$new"
    git push -q -u origin "$branch"
    gh pr create --base main --head "$branch" --title "chore(release): v$new" \
      --body "$(printf 'Version bump + changelog roll for **v%s**. The tag and GitHub release follow the merge, via `just release-publish`.\n\n---\n\n%s\n' "$new" "$notes")"
    echo
    echo "release: v$new prepared on $branch"
    echo "  next: merge the PR (ci-gate must pass), then run: just release-publish"

# Run this once the release PR has merged. Tags the merged commit on main and
# pushes the tag (that build publishes the ghcr X.Y.Z image plus the rolling
# X.Y / X / latest aliases), then publishes the GitHub release from that version's
# changelog section. Refuses unless main is clean, up to date, actually carries the
# version being released, and has no failed checks.
# Release step 2: tag the merged release commit + publish the GitHub release.
release-publish:
    #!/usr/bin/env bash
    set -euo pipefail
    cd "{{justfile_directory()}}"
    [ "$(git branch --show-current)" = "main" ] || { echo "release-publish: not on main (merge the release PR, then switch to main)"; exit 1; }
    [ -z "$(git status --porcelain)" ] || { echo "release-publish: working tree not clean"; exit 1; }
    git pull --ff-only >/dev/null
    new=$(awk -F'"' '/^version = /{print $2; exit}' Cargo.toml)
    ! git rev-parse --verify --quiet "v$new" >/dev/null || { echo "release-publish: v$new is already tagged"; exit 1; }
    # The notes now live under the rolled-in section, not [Unreleased].
    notes=$(awk -v v="$new" '$0 ~ "^## \\[" v "\\]" {f=1; next} /^## \[/{f=0} f' CHANGELOG.md | sed -e '/^[[:space:]]*$/d' || true)
    [ -n "$notes" ] || { echo "release-publish: CHANGELOG.md has no [$new] section — has the release PR merged?"; exit 1; }
    # main is gated on ci-gate; never tag a commit whose checks failed. Fails
    # CLOSED: an unreadable answer (no network, no auth, API change) must not be
    # mistaken for "nothing failed".
    sha=$(git rev-parse HEAD)
    bad=$(gh api "repos/{owner}/{repo}/commits/$sha/check-runs" -q '[.check_runs[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")] | length' || true)
    case "$bad" in
        ''|*[!0-9]*) echo "release-publish: could not read check status for $sha (got '$bad') — not tagging"; exit 1 ;;
    esac
    if [ "$bad" != "0" ]; then
        echo "release-publish: $bad failed check(s) on $sha — not tagging:"
        gh api "repos/{owner}/{repo}/commits/$sha/check-runs" -q '.check_runs[] | "  " + .name + ": " + (.conclusion // "pending")'
        exit 1
    fi
    git tag -a "v$new" -m "dice $new"
    git push -q origin "v$new"
    gh release create "v$new" --title "dice v$new" --notes "$notes"
    echo "release: v$new published — the tag build rolls the ghcr aliases"
    # Not deleted automatically: `git branch -d` judges "merged" against the
    # branch's UPSTREAM, not main, so it declines in exactly the case that matters
    # and a silent `|| true` would hide it. It's one command when you want it.
    # (An `if`, not `&&` — as the recipe's last line under `set -e`, a missing
    # branch would otherwise fail the whole recipe after a successful release.)
    if git rev-parse --verify --quiet "release/v$new" >/dev/null; then
        echo "  (local branch left behind: git branch -D release/v$new)"
    fi
