//! One WebSocket per player per game: `GET /ws/games/{code}?token=…`. The token
//! is a query param because browsers can't set headers on a WS handshake. The
//! `tokio::select!` loop fans broadcast messages out to this socket and applies
//! this client's messages to the room (the `nib` pattern).

use std::sync::{Arc, Mutex};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::IntoResponse;
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;

use crate::room::{ClientMsg, Room, ServerMsg};
use crate::AppState;

#[derive(Deserialize)]
pub struct WsAuth {
    pub token: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(code): Path<String>,
    Query(q): Query<WsAuth>,
    State(st): State<AppState>,
) -> impl IntoResponse {
    // The protocol messages are tiny (a roll, a name, a reorder of a handful of
    // ids). Cap the frame/message size hard so an un-authed client can't force a
    // large allocation on this public endpoint.
    ws.max_message_size(16 * 1024)
        .max_frame_size(16 * 1024)
        .on_upgrade(move |socket| handle_socket(socket, code, q.token, st))
}

async fn handle_socket(mut socket: WebSocket, code: String, token: String, st: AppState) {
    let code = code.to_uppercase();
    // Take the room out of the registry into a local BEFORE the let-else, so the
    // registry MutexGuard temporary is dropped here and never held across the
    // `.await` in the else branch (a !Send future otherwise).
    let room = st.rooms.lock().unwrap().get(&code).cloned();
    let Some(room) = room else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    };

    // Authenticate by token, mark connected, subscribe, snapshot — all under one
    // lock, returning owned data so the guard is dropped before any `.await`
    // (holding a MutexGuard across await makes the future !Send).
    let attached = {
        let mut r = room.lock().unwrap();
        match r.player_id_for_token(&token) {
            Some(my_id) => {
                let rx = r.tx.subscribe();
                r.set_connected(&my_id, true);
                let snap = r.snapshot();
                let liars = r.liars_view(&my_id);
                Some((my_id, rx, snap, liars))
            }
            None => None,
        }
    };
    let Some((my_id, mut rx, snapshot, liars)) = attached else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    };

    // Push the full state to just this socket: the base snapshot, plus a
    // personalized Liar's Dice view if a match is running.
    for msg in std::iter::once(ServerMsg::Sync { state: snapshot })
        .chain(liars.map(|view| ServerMsg::Liars { view }))
    {
        if let Ok(txt) = serde_json::to_string(&msg) {
            if socket.send(Message::Text(txt.into())).await.is_err() {
                mark_disconnected(&room, &my_id);
                return;
            }
        }
    }

    loop {
        tokio::select! {
            bc = rx.recv() => match bc {
                Ok(msg) => {
                    // `LiarsChanged` is a rebuild signal — turn it into THIS
                    // socket's personalized view so hidden dice never go out
                    // verbatim. The lock guard is dropped before the await.
                    let out = match msg {
                        ServerMsg::LiarsChanged => {
                            let view = room.lock().unwrap().liars_view(&my_id);
                            match view {
                                Some(view) => ServerMsg::Liars { view },
                                None => continue,
                            }
                        }
                        other => other,
                    };
                    let Ok(txt) = serde_json::to_string(&out) else { continue };
                    if socket.send(Message::Text(txt.into())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            },
            ws = socket.recv() => match ws {
                Some(Ok(Message::Text(t))) => {
                    if let Ok(msg) = serde_json::from_str::<ClientMsg>(t.as_str()) {
                        // Leave removes the player; close the socket too so an
                        // ex-member can't keep acting / keep the room alive.
                        let leaving = matches!(msg, ClientMsg::Leave);
                        room.lock().unwrap().apply(&my_id, msg);
                        if leaving {
                            break;
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(_)) => {}
                Some(Err(_)) => break,
            },
        }
    }

    mark_disconnected(&room, &my_id);
}

fn mark_disconnected(room: &Arc<Mutex<Room>>, my_id: &str) {
    if let Ok(mut r) = room.lock() {
        r.set_connected(my_id, false);
    }
}
