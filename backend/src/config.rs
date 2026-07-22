//! Plain `env::var()` → `Config`. The seam contract fields (`DICE_BIND`,
//! `STATIC_DIR`) match the family so the frontend + deploy halves line up. This
//! app is public (no oauth2-proxy gating, no login), so there is no `dev_auth`
//! switch and no DB — game state is in-memory and ephemeral.

use std::env;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Config {
    /// Listen address. `DICE_BIND`, default `0.0.0.0:3040`.
    pub bind: String,
    /// Directory of the built SPA to serve (Vite `dist/`). `STATIC_DIR`,
    /// default `./dist`.
    pub static_dir: PathBuf,
    /// Idle lifetime of a game room. `DICE_TTL_SECS`, default 7200 (2h), min 1.
    /// A room with no activity for this long is reaped; its code then 404s.
    pub ttl: Duration,
    /// Maximum dice per roll. `DICE_MAX`, default 8.
    pub max_dice: u8,
    /// Cap on concurrent rooms — bounds memory on this public, un-authed
    /// endpoint. `DICE_MAX_ROOMS`, default 5000.
    pub max_rooms: usize,
    /// Cap on players per room. `DICE_MAX_PLAYERS`, default 16.
    pub max_players: usize,
    /// Trust `X-Forwarded-For` / `X-Real-IP` for the client IP used in per-IP
    /// abuse limits. `DICE_TRUST_PROXY`, default false. **Must be true when a
    /// reverse proxy (Traefik/nginx) fronts this app** — otherwise every request
    /// looks like it comes from the proxy and all clients share one rate bucket.
    /// **Must be false when directly exposed** — otherwise a client can spoof the
    /// header to dodge per-IP limits. See `guard::ClientIp`.
    pub trust_proxy: bool,
    /// Per-IP room creations allowed per minute (also the burst size).
    /// `DICE_RL_CREATE_PER_MIN`, default 10. The main lever against one source
    /// filling `max_rooms` and denying the whole service.
    pub create_per_min: u32,
    /// Per-IP joins allowed per minute (also the burst). `DICE_RL_JOIN_PER_MIN`,
    /// default 60 — generous, since a venue full of phones can share one NAT IP.
    pub join_per_min: u32,
    /// Max concurrent WebSockets from a single IP. `DICE_WS_PER_IP`, default 24
    /// (again NAT-friendly: many players behind one router).
    pub ws_per_ip: u32,
    /// Global cap on concurrent WebSockets — bounds live tasks/sockets.
    /// `DICE_MAX_WS`, default 20000.
    pub max_ws: usize,
    /// Per-connection inbound message budget per second (burst = 2×). Neutralizes
    /// broadcast amplification (one client message fans a snapshot to the whole
    /// room). `DICE_WS_MSGS_PER_SEC`, default 20.
    pub ws_msgs_per_sec: u32,
    /// Optional path to persist live games across a graceful restart (deploy /
    /// reboot). `DICE_STATE_FILE`, unset by default → fully ephemeral (a restart
    /// drops every game, the original model). When set, the rooms are flushed to
    /// this file on shutdown and reloaded (then the file is consumed) on the next
    /// boot, so reconnecting clients resume. **The file contains secret player
    /// tokens** — it is written `0600` and must live on a non-public,
    /// per-restart-persistent path (a mounted volume in prod, since the container
    /// filesystem is replaced on deploy). Does NOT survive a hard crash — only a
    /// graceful SIGTERM/SIGINT shutdown flushes it.
    pub state_file: Option<PathBuf>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let ttl_secs: u64 = env::var("DICE_TTL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .filter(|&n| n >= 1) // 0 would reap every room within a tick
            .unwrap_or(7200);
        let max_dice: u8 = env::var("DICE_MAX")
            .ok()
            .and_then(|s| s.parse().ok())
            .filter(|&n| n >= 1)
            .unwrap_or(8);
        let max_rooms: usize = env::var("DICE_MAX_ROOMS")
            .ok()
            .and_then(|s| s.parse().ok())
            .filter(|&n| n >= 1)
            .unwrap_or(5000);
        let max_players: usize = env::var("DICE_MAX_PLAYERS")
            .ok()
            .and_then(|s| s.parse().ok())
            .filter(|&n| n >= 1)
            .unwrap_or(16);
        Ok(Self {
            bind: env::var("DICE_BIND").unwrap_or_else(|_| "0.0.0.0:3040".into()),
            static_dir: PathBuf::from(env::var("STATIC_DIR").unwrap_or_else(|_| "./dist".into())),
            ttl: Duration::from_secs(ttl_secs),
            max_dice,
            max_rooms,
            max_players,
            trust_proxy: env_bool("DICE_TRUST_PROXY", false),
            create_per_min: env_u32("DICE_RL_CREATE_PER_MIN", 10, 1),
            join_per_min: env_u32("DICE_RL_JOIN_PER_MIN", 60, 1),
            ws_per_ip: env_u32("DICE_WS_PER_IP", 24, 1),
            max_ws: env::var("DICE_MAX_WS")
                .ok()
                .and_then(|s| s.parse().ok())
                .filter(|&n| n >= 1)
                .unwrap_or(20000),
            ws_msgs_per_sec: env_u32("DICE_WS_MSGS_PER_SEC", 20, 1),
            // Blank/whitespace is treated as unset (ephemeral).
            state_file: env::var("DICE_STATE_FILE")
                .ok()
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
                .map(PathBuf::from),
        })
    }
}

/// Parse a `u32` env var, applying a floor and falling back to `default`.
fn env_u32(key: &str, default: u32, min: u32) -> u32 {
    env::var(key)
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n >= min)
        .unwrap_or(default)
}

/// Parse a boolean env var: truthy = `1`/`true`/`yes`/`on` (case-insensitive).
fn env_bool(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        Err(_) => default,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sane() {
        // Read with no app env set: contract defaults hold.
        let cfg = Config::from_env().unwrap();
        assert!(cfg.max_dice >= 1);
        assert!(cfg.ttl.as_secs() > 0);
        assert!(cfg.max_rooms >= 1);
        assert!(cfg.max_players >= 1);
        // Abuse guards default to safe values (proxy header NOT trusted).
        assert!(!cfg.trust_proxy);
        assert!(cfg.create_per_min >= 1);
        assert!(cfg.join_per_min >= 1);
        assert!(cfg.ws_per_ip >= 1);
        assert!(cfg.max_ws >= 1);
        assert!(cfg.ws_msgs_per_sec >= 1);
    }

    #[test]
    fn env_bool_parsing() {
        assert!(!env_bool("DICE_NOPE_UNSET", false));
        assert!(env_bool("DICE_NOPE_UNSET", true));
    }
}
