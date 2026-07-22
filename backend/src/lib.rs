//! dice backend — boot flow + shared state. `main.rs` is one line:
//! `dice_backend::run_server().await`. Game state is entirely in-memory and
//! ephemeral: a background task reaps rooms idle past the configured TTL, after
//! which their codes 404.

mod config;
mod error;
mod guard;
mod persist;
mod room;
mod routes;
mod ws;

use std::future::IntoFuture;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use tracing_subscriber::EnvFilter;

pub use config::Config;
use guard::Guard;
use room::{new_rooms, Rooms};

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub rooms: Rooms,
    pub guard: Arc<Guard>,
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
    let guard = Arc::new(Guard::from_cfg(&cfg));
    let rooms = new_rooms();

    // Optional persistence: reload games flushed by the previous (graceful)
    // shutdown, then the file is consumed. Off unless DICE_STATE_FILE is set.
    let state_file = cfg.state_file.clone();
    if let Some(path) = state_file.as_deref() {
        persist::load(&rooms, path);
    }

    let state = AppState {
        cfg: Arc::new(cfg),
        rooms: rooms.clone(),
        guard: guard.clone(),
    };

    let ttl = state.cfg.ttl;
    tokio::spawn(reap_loop(rooms.clone(), ttl));
    tokio::spawn(guard_sweep_loop(guard));

    let bind = state.cfg.bind.clone();
    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(%bind, "dice listening");
    // `ConnectInfo` gives handlers the TCP peer address — the client IP used by
    // the per-IP abuse guards when no trusted proxy is in front.
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .into_future();

    // Race the server against the shutdown signal. On SIGTERM/SIGINT we flush the
    // live games (if persistence is on) and return immediately — dropping the
    // server future closes the listener and open sockets. We flush BEFORE draining
    // so a short SIGTERM→SIGKILL grace window can't truncate the write; clients
    // reconnect and resume from the restored state on the next boot.
    tokio::select! {
        res = server => res?,
        () = shutdown_signal() => match state_file.as_deref() {
            Some(path) => {
                tracing::info!("shutdown signal received — flushing game state");
                persist::save(&rooms, path);
            }
            None => tracing::info!("shutdown signal received — ephemeral (no DICE_STATE_FILE)"),
        },
    }
    Ok(())
}

/// Resolve when the process is asked to stop: SIGINT (ctrl-c, dev) or SIGTERM
/// (the signal an orchestrator sends on `stop` / a rolling deploy).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            // If we can't install the handler, never resolve on this branch —
            // ctrl-c still works.
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
}

/// Periodically drop idle per-IP rate-limit buckets so the guard maps stay
/// bounded after a burst of distinct sources subsides.
async fn guard_sweep_loop(guard: Arc<Guard>) {
    let mut interval = tokio::time::interval(Duration::from_secs(120));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        guard.sweep();
    }
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
