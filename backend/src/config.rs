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
        })
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
    }
}
