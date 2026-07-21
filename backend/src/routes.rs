//! Router + REST handlers + the house SPA-serving + CSP seams.

use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::sync::{Arc, Mutex};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::error::AppError;
use crate::guard::ClientIp;
use crate::room::{gen_code, Room, Snapshot};
use crate::ws::ws_handler;
use crate::AppState;

/// Hard cap on request bodies. The only bodies are a tiny `{ name }` JSON; this
/// keeps an un-authed client from forcing a large allocation on POST.
const BODY_LIMIT: usize = 16 * 1024;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/status", get(status))
        .route("/api/games", post(create_game))
        .route("/api/games/{code}", get(get_game))
        .route("/api/games/{code}/join", post(join_game))
        .route("/ws/games/{code}", get(ws_handler))
        .fallback(get(serve_spa))
        // Layers wrap every route above (incl. the SPA fallback) so the CSP is
        // present on the HTML shell too.
        .layer(csp_layer())
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

// ---------- REST ----------

#[derive(Deserialize)]
struct NameBody {
    name: Option<String>,
}

#[derive(Deserialize)]
struct CreateBody {
    name: Option<String>,
    /// Optional game to start the room in ("free" | "liars" | "yatzy"). The host
    /// picks it in the lobby; unknown/absent = free.
    mode: Option<String>,
}

async fn create_game(
    State(st): State<AppState>,
    ClientIp(ip): ClientIp,
    body: Option<Json<CreateBody>>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Per-IP throttle: the main lever against one source filling `max_rooms`.
    if !st.guard.create.allow(ip) {
        return Err(AppError::TooMany);
    }
    let body = body.map(|b| b.0);
    let name = body
        .as_ref()
        .and_then(|b| b.name.clone())
        .unwrap_or_default();
    let mode = body.and_then(|b| b.mode);
    let mut map = st.rooms.lock().unwrap();
    // Bound memory on this public, un-authed endpoint.
    if map.len() >= st.cfg.max_rooms {
        return Err(AppError::Busy);
    }
    let code = gen_code(&map);
    let room = Arc::new(Mutex::new(Room::new(code.clone(), st.cfg.max_dice)));
    let (player_id, token) = {
        let mut r = room.lock().unwrap();
        let ids = r.add_player(name);
        // Start the chosen game up front (free needs nothing). No subscribers yet,
        // so the broadcasts are no-ops; the host's first connect gets the view.
        if let Some(m) = mode.as_deref() {
            if m == "liars" || m == "yatzy" || m == "farkle" {
                r.set_game_mode(m);
            }
        }
        ids
    };
    map.insert(code.clone(), room);
    Ok(Json(
        json!({ "code": code, "playerId": player_id, "token": token }),
    ))
}

async fn join_game(
    State(st): State<AppState>,
    ClientIp(ip): ClientIp,
    Path(code): Path<String>,
    body: Option<Json<NameBody>>,
) -> Result<Json<serde_json::Value>, AppError> {
    if !st.guard.join.allow(ip) {
        return Err(AppError::TooMany);
    }
    let code = code.to_uppercase();
    let room = st
        .rooms
        .lock()
        .unwrap()
        .get(&code)
        .cloned()
        .ok_or(AppError::NotFound)?;
    let name = body.and_then(|b| b.0.name).unwrap_or_default();
    let (player_id, token) = {
        let mut r = room.lock().unwrap();
        if r.player_count() >= st.cfg.max_players {
            return Err(AppError::RoomFull);
        }
        let ids = r.add_player(name);
        // If a not-yet-started Liar's/Yatzy match is set, re-deal to include the
        // newcomer (the "create → friends join → play" flow); else they spectate.
        r.on_player_joined();
        // Let existing clients see the newcomer (grayed until they connect).
        r.broadcast_sync();
        ids
    };
    Ok(Json(
        json!({ "code": code, "playerId": player_id, "token": token }),
    ))
}

async fn get_game(
    State(st): State<AppState>,
    Path(code): Path<String>,
) -> Result<Json<Snapshot>, AppError> {
    let code = code.to_uppercase();
    let room = st
        .rooms
        .lock()
        .unwrap()
        .get(&code)
        .cloned()
        .ok_or(AppError::NotFound)?;
    let snap = room.lock().unwrap().snapshot();
    Ok(Json(snap))
}

async fn status(State(st): State<AppState>) -> Json<serde_json::Value> {
    let rooms = st.rooms.lock().unwrap().len();
    Json(json!({
        "service": "dice",
        "version": env!("CARGO_PKG_VERSION"),
        "rooms": rooms,
    }))
}

// ---------- SPA serving (frontend-agnostic) ----------

/// Serve a real built asset under `static_dir`, else `index.html` with 200 so
/// the client router owns the route. canonicalize + starts_with rejects `..`.
async fn serve_spa(State(state): State<AppState>, uri: Uri) -> Response {
    let base = &state.cfg.static_dir;
    let rel = uri.path().trim_start_matches('/');
    if !rel.is_empty() {
        let cand = base.join(rel);
        if let (Ok(c), Ok(b)) = (cand.canonicalize(), base.canonicalize()) {
            if c.starts_with(&b) && c.is_file() {
                if let Ok(bytes) = tokio::fs::read(&c).await {
                    let mime = mime_guess::from_path(&c).first_or_octet_stream();
                    return ([(header::CONTENT_TYPE, mime.as_ref())], bytes).into_response();
                }
            }
        }
    }
    match tokio::fs::read_to_string(base.join("index.html")).await {
        Ok(html) => Html(html).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

// ---------- CSP ----------

/// Fully same-origin: fonts are self-hosted (@fontsource, bundled into `dist`),
/// so no `https://fonts.*` exceptions. `img-src ... blob:` covers canvas-generated
/// dice textures / QR data URLs; the same-origin WebSocket is allowed by
/// `connect-src 'self'`. three.js + cannon-es are plain bundled JS, so no
/// `'wasm-unsafe-eval'` is needed.
///
/// `script-src` includes `'unsafe-inline'`: SvelteKit's static build emits a
/// small inline bootstrap `<script>` with no stable hash across version bumps.
/// The app renders no user-supplied HTML (Svelte escapes every interpolation;
/// no `{@html}`), so the practical XSS surface is negligible. `style-src` needs
/// `'unsafe-inline'` for Svelte's scoped/inline styles.
fn csp_layer() -> SetResponseHeaderLayer<HeaderValue> {
    const CSP: &str = "default-src 'self'; \
         script-src 'self' 'unsafe-inline'; \
         style-src 'self' 'unsafe-inline'; \
         font-src 'self' data:; \
         img-src 'self' data: blob:; \
         connect-src 'self'; \
         manifest-src 'self'; \
         frame-ancestors 'none'; \
         base-uri 'self'; \
         object-src 'none'; \
         form-action 'self'";
    SetResponseHeaderLayer::if_not_present(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CSP),
    )
}
