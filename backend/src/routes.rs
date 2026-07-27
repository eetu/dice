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
/// Cap for `POST /api/client-error` — a `kind`, a truncated message and a URL.
const CLIENT_ERROR_LIMIT: usize = 1024;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/status", get(status))
        .route("/api/games", post(create_game))
        .route("/api/games/{code}", get(get_game))
        .route("/api/games/{code}/join", post(join_game))
        // Browser error reports. Route-scoped body cap: the global 16 KiB is for
        // game payloads and is far too generous for a fixed four-field record.
        .route(
            "/api/client-error",
            post(client_error).layer(DefaultBodyLimit::max(CLIENT_ERROR_LIMIT)),
        )
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
    // Bound memory on this public, un-authed endpoint. At the cap, free the
    // stalest ABANDONED room rather than refusing outright: rooms live a day now
    // (`DICE_TTL_SECS`) and a closed tab never sends `leave`, so the table fills
    // with games nobody is in — and a plain 503 would mean nobody can start a
    // game until the reaper catches up hours later.
    if map.len() >= st.cfg.max_rooms && !evict_stalest_idle(&mut map) {
        // Every room has someone connected: the cap is doing its real job.
        return Err(AppError::Busy);
    }
    let code = gen_code(&map);
    let room = Arc::new(Mutex::new(Room::new(
        code.clone(),
        st.cfg.max_dice,
        st.cfg.max_players,
    )));
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
    let mode_attr = match mode.as_deref() {
        Some("liars") => "liars",
        Some("yatzy") => "yatzy",
        Some("farkle") => "farkle",
        _ => "free",
    };
    crate::telemetry::metrics()
        .games_created
        .add(1, &crate::telemetry::attr("mode", mode_attr));
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
    // A join can re-deal a pristine match whose first seat is a bot — make sure
    // the pump is running. (After the lock scope: schedule_pump locks the room.)
    crate::bot::schedule_pump(room, st.cfg.bot_delay_ms);
    crate::telemetry::metrics().players_joined.add(1, &[]);
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

/// Drop the least-recently-active room that nobody is connected to. Returns false
/// when every room has a live human, which is the only case where refusing a
/// create is the right answer.
///
/// Takes each room's lock briefly while holding the registry lock — the same
/// pattern (and ordering) as the TTL reaper, and there's no `.await` inside.
fn evict_stalest_idle(map: &mut std::collections::HashMap<String, Arc<Mutex<Room>>>) -> bool {
    let victim = map
        .iter()
        .filter_map(|(code, room)| {
            let r = room.lock().ok()?;
            if r.has_connected_human() {
                return None; // never evict a room someone is playing in
            }
            Some((r.last_activity, code.clone()))
        })
        .min_by_key(|(seen, _)| *seen)
        .map(|(_, code)| code);
    match victim {
        Some(code) => {
            tracing::info!(%code, "evicted stalest idle room to make space");
            map.remove(&code);
            crate::telemetry::metrics()
                .rooms_reaped
                .add(1, &crate::telemetry::attr("reason", "evicted"));
            true
        }
        None => false,
    }
}

// ---------- client error reports ----------

/// The closed set of things the browser can report. It becomes a metric
/// attribute, so the cardinality must be bounded — hence a match, not a string
/// passthrough. Mirrors `ReportKind` in `frontend/src/lib/report.ts`; the
/// integration test asserts every one of them is accepted, because a drift here
/// silently 400s reports exactly when something is already broken.
///
/// Never started: `boot` `noEsm` `chunk` `storage`.
/// Started, then broke: `runtime` `render` `route` `ws` `join`.
const CLIENT_ERROR_KINDS: [&str; 9] = [
    "boot", "noEsm", "chunk", "storage", "runtime", "render", "route", "ws", "join",
];

#[derive(Deserialize)]
struct ClientErrorBody {
    kind: String,
    message: Option<String>,
    url: Option<String>,
}

/// Trim attacker-controlled text down to something safe to log: no control
/// characters (log injection / forged lines), no newlines, hard length cap.
fn sanitize(s: &str, max: usize) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

/// `POST /api/client-error` — the browser reporting that it couldn't start or
/// couldn't connect. Un-authed like everything else here, so it's rate limited
/// per IP, body-capped, and every field is a closed enum or sanitized text.
///
/// Why it exists: a blank page can't describe itself, and the report we actually
/// got ("it didn't work on Android") was unactionable. This turns the next one
/// into a counter plus a searchable log line with a real User-Agent.
async fn client_error(
    State(st): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: axum::http::HeaderMap,
    body: Json<ClientErrorBody>,
) -> Result<StatusCode, AppError> {
    if !st.guard.client_error.allow(ip) {
        return Err(AppError::TooMany);
    }
    // An unknown kind is dropped, never recorded — otherwise anyone could mint
    // metric label values.
    let Some(kind) = CLIENT_ERROR_KINDS.iter().find(|k| **k == body.kind) else {
        return Err(AppError::BadRequest);
    };
    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .map(|v| sanitize(v, 200))
        .unwrap_or_default();
    let message = body
        .message
        .as_deref()
        .map(|m| sanitize(m, 200))
        .unwrap_or_default();
    let url = body
        .url
        .as_deref()
        .map(|u| sanitize(u, 200))
        .unwrap_or_default();

    crate::telemetry::metrics()
        .client_errors
        .add(1, &crate::telemetry::attr("kind", kind));
    // Exported as an OTLP log record when telemetry is on (see telemetry.rs);
    // otherwise it's just a local log line.
    // `detail`, NOT `message`: a field named `message` IS the event's message in
    // tracing, so it overwrote the "client error" literal — the exported record's
    // body became the detail text and there was no stable marker to filter on.
    tracing::warn!(
        kind = %kind,
        detail = %message,
        url = %url,
        ua = %ua,
        "client error"
    );
    Ok(StatusCode::NO_CONTENT)
}

// ---------- SPA serving (frontend-agnostic) ----------

/// The SvelteKit build directory (`frontend/svelte.config.js` → `appDir`, default
/// `_app`). Everything under it is a content-hashed build artifact: it either
/// exists or it's gone, and it must NEVER fall through to the HTML shell.
const APP_DIR: &str = "_app/";
/// Hashed filenames change on every build, so the bytes behind a given URL never do.
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

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
                    let cache = if rel.starts_with(APP_DIR) {
                        IMMUTABLE
                    } else {
                        // Icons/manifest keep their names across builds — a short
                        // TTL, so a new icon isn't pinned for a year.
                        "public, max-age=3600"
                    };
                    return (
                        [
                            (header::CONTENT_TYPE, mime.as_ref()),
                            (header::CACHE_CONTROL, cache),
                        ],
                        bytes,
                    )
                        .into_response();
                }
            }
        }
        // A missing build artifact is a 404, never the shell. Returning
        // `index.html` here (status 200, `text/html`) meant a client holding a
        // stale shell asked for a chunk that no longer exists and got HTML, which
        // the browser refuses to execute as a module: a blank page with nothing
        // to report. Worse, the version poll then reload-looped on it.
        if rel.starts_with(APP_DIR) {
            return (StatusCode::NOT_FOUND, "not found").into_response();
        }
    }
    match tokio::fs::read_to_string(base.join("index.html")).await {
        // `no-cache` = always revalidate. The shell names the hashed chunks, so a
        // cached one outliving its deploy is exactly the failure above.
        Ok(html) => (
            [(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"))],
            Html(html),
        )
            .into_response(),
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
