//! Spawned-binary integration tests. `#[ignore]` (they bind a port + spawn a
//! process); run with `cargo test -p dice-integration -- --ignored`.

use dice_integration::{Stack, Ws};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

async fn next_json(ws: &mut Ws) -> Value {
    loop {
        let msg = ws.next().await.expect("ws closed").expect("ws error");
        if let Message::Text(t) = msg {
            return serde_json::from_str(t.as_str()).expect("json");
        }
        // ignore ping/pong/binary/close
    }
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn status_up() {
    let s = Stack::start().await.unwrap();
    let body: Value = s.get("/status").await.json().await.unwrap();
    assert_eq!(body["service"], "dice");
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn create_join_and_snapshot() {
    let s = Stack::start().await.unwrap();
    let alice = s.create("Alice").await;
    let code = alice["code"].as_str().unwrap().to_string();

    // Join with a lowercase code (should be accepted case-insensitively).
    let r = s
        .post_json(
            &format!("/api/games/{}/join", code.to_lowercase()),
            json!({ "name": "Bob" }),
        )
        .await;
    assert!(r.status().is_success(), "join → {}", r.status());

    let snap: Value = s
        .get(&format!("/api/games/{code}"))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(snap["players"].as_array().unwrap().len(), 2);
    assert_eq!(snap["currentPlayerId"], alice["playerId"]);
    // The secret token must never appear in a snapshot.
    assert!(!snap.to_string().contains("token"));
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn join_unknown_code_404() {
    let s = Stack::start().await.unwrap();
    let r = s
        .post_json("/api/games/ZZZZZ/join", json!({ "name": "x" }))
        .await;
    assert_eq!(r.status(), reqwest::StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn ws_roll_roundtrip() {
    let s = Stack::start().await.unwrap();
    let alice = s.create("Alice").await;
    let code = alice["code"].as_str().unwrap();
    let token = alice["token"].as_str().unwrap();

    let mut ws = s.ws(code, token).await;

    // First frame is the full snapshot.
    let sync = next_json(&mut ws).await;
    assert_eq!(sync["type"], "sync");
    assert_eq!(sync["state"]["players"].as_array().unwrap().len(), 1);
    assert_eq!(sync["state"]["diceCount"], 2);

    // Roll (Alice is the only, current, player).
    ws.send(Message::text(json!({ "type": "roll" }).to_string()))
        .await
        .unwrap();

    let mut rolled = None;
    for _ in 0..10 {
        let m = next_json(&mut ws).await;
        if m["type"] == "rolled" {
            rolled = Some(m);
            break;
        }
    }
    let rolled = rolled.expect("no rolled message received");
    let dice = rolled["record"]["dice"].as_array().unwrap();
    assert_eq!(dice.len(), 2);
    for d in dice {
        let v = d.as_u64().unwrap();
        assert!((1..=6).contains(&v), "face out of range: {v}");
    }
    assert_eq!(rolled["record"]["playerId"], alice["playerId"]);
}
