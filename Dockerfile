# syntax=docker/dockerfile:1

# --- Cross-compilation helper ---
FROM --platform=$BUILDPLATFORM tonistiigi/xx AS xx

# --- Stage 1: Build the SPA (native; output is platform-independent) ---
# Vendored yarn (no corepack): copy the manifest + lockfile + vendored release,
# install --immutable, then build. node version matches frontend/.node-version.
FROM --platform=$BUILDPLATFORM node:24-alpine AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/yarn.lock frontend/.yarnrc.yml ./
COPY frontend/.yarn/releases ./.yarn/releases
RUN node .yarn/releases/yarn-*.cjs install --immutable --network-timeout 1000000
COPY frontend/ .
RUN node .yarn/releases/yarn-*.cjs build

# --- Stage 2: Warm the cross-compiled dependency cache with stub sources ---
FROM --platform=$BUILDPLATFORM rust:1-alpine AS workspace-deps
COPY --from=xx / /
RUN apk add --no-cache clang lld musl-dev curl
ARG TARGETPLATFORM
RUN xx-apk add --no-cache musl-dev gcc
WORKDIR /app
# All workspace members' manifests are needed to load the workspace, even though
# only `dice-backend` is built (integration is a test-only member — stub it).
COPY Cargo.toml Cargo.lock ./
COPY backend/Cargo.toml backend/Cargo.toml
COPY integration/Cargo.toml integration/Cargo.toml
RUN mkdir -p backend/src integration/src \
    && printf 'fn main() {}\n' > backend/src/main.rs \
    && : > backend/src/lib.rs \
    && : > integration/src/lib.rs \
    && xx-cargo build --release -p dice-backend

# --- Stage 3: Build the backend against real sources ---
FROM workspace-deps AS backend-build
ARG TARGETPLATFORM
COPY backend/src ./backend/src
# `touch` so cargo notices the stub→real swap.
RUN touch backend/src/main.rs backend/src/lib.rs \
    && xx-cargo build --release -p dice-backend \
    && cp target/*/release/dice-backend /dice-backend

# --- Stage 4: Runtime (scratch + static musl binary + dist + CA certs) ---
FROM scratch AS runner
WORKDIR /app
LABEL org.opencontainers.image.description="dice — realtime turn-based 3D dice roller"
LABEL org.opencontainers.image.source="https://github.com/eetu/dice"

COPY --from=backend-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=backend-build /dice-backend ./dice-backend
COPY --from=frontend-build /app/dist ./dist

ENV STATIC_DIR=./dist
ENV DICE_BIND=0.0.0.0:3040

USER 1000
EXPOSE 3040
CMD ["./dice-backend"]
