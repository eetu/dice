//! dice backend — boot flow + shared state. `main.rs` is one line:
//! `dice_backend::run_server().await`. Game state is entirely in-memory and
//! ephemeral: a background task reaps rooms idle past the configured TTL, after
//! which their codes 404.

mod config;
mod error;
mod room;
mod routes;
mod ws;

use std::sync::Arc;
use std::time::Duration;

use tracing_subscriber::EnvFilter;

pub use config::Config;
use room::{new_rooms, Rooms};

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub rooms: Rooms,
}

pub async fn run_server() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,dice_backend=debug")),
        )
        .init();

    let cfg = Config::from_env()?;
    let rooms = new_rooms();
    let state = AppState {
        cfg: Arc::new(cfg),
        rooms: rooms.clone(),
    };

    let ttl = state.cfg.ttl;
    tokio::spawn(reap_loop(rooms, ttl));

    let bind = state.cfg.bind.clone();
    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "dice listening");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Periodically drop rooms with no activity for longer than `ttl`.
async fn reap_loop(rooms: Rooms, ttl: Duration) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let (before, after) = {
            let mut map = rooms.lock().unwrap();
            let before = map.len();
            map.retain(|_code, room| {
                room.lock()
                    .map(|r| r.last_activity.elapsed() < ttl)
                    .unwrap_or(false)
            });
            (before, map.len())
        };
        if before != after {
            tracing::info!(
                reaped = before - after,
                remaining = after,
                "reaped idle rooms"
            );
        }
    }
}
