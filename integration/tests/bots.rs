//! Bot end-to-end: a server-side bot added over the WS plays its turns
//! autonomously against the real spawned binary. `DICE_BOT_DELAY_MS=10`
//! fast-forwards the human-ish thinking delays. `#[ignore]`; run with
//! `cargo test -p dice-integration -- --ignored`.

use std::time::Duration;

use dice_integration::{Stack, Ws};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::Message;

async fn next_json(ws: &mut Ws) -> Value {
    loop {
        let msg = tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .expect("timed out waiting for a ws message")
            .expect("ws closed")
            .expect("ws error");
        if let Message::Text(t) = msg {
            return serde_json::from_str(t.as_str()).expect("json");
        }
    }
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn yatzy_bot_plays_its_turn_autonomously() {
    let s = Stack::start_with(&[("DICE_BOT_DELAY_MS", "10")])
        .await
        .unwrap();
    let alice = s
        .post_json("/api/games", json!({ "name": "Alice", "mode": "yatzy" }))
        .await
        .json::<Value>()
        .await
        .unwrap();
    let code = alice["code"].as_str().unwrap();
    let token = alice["token"].as_str().unwrap();
    let my_id = alice["playerId"].as_str().unwrap().to_string();

    let mut ws = s.ws(code, token).await;
    assert_eq!(next_json(&mut ws).await["type"], "sync");

    // Seat a hard bot: the next sync shows it (bot: true, no skill leaked).
    ws.send(Message::text(
        json!({ "type": "addBot", "skill": "hard" }).to_string(),
    ))
    .await
    .unwrap();
    let bot_id = loop {
        let m = next_json(&mut ws).await;
        if m["type"] == "sync" {
            let players = m["state"]["players"].as_array().unwrap();
            if let Some(bot) = players.iter().find(|p| p["bot"] == true) {
                assert!(!m.to_string().contains("skill"), "skill must stay secret");
                break bot["id"].as_str().unwrap().to_string();
            }
        }
    };

    // Play out the human's first turn (roll once, score Chance)…
    ws.send(Message::text(json!({ "type": "yatzyRoll" }).to_string()))
        .await
        .unwrap();
    ws.send(Message::text(
        json!({ "type": "yatzyScore", "category": "chance" }).to_string(),
    ))
    .await
    .unwrap();

    // …then the bot rolls/holds/scores on its own until the turn returns with
    // its card one box fuller.
    loop {
        let m = next_json(&mut ws).await;
        if m["type"] != "yatzy" {
            continue;
        }
        let v = &m["view"];
        let bot_cells = v["cards"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["playerId"] == bot_id.as_str())
            .map(|c| c["cells"].as_array().unwrap().len())
            .unwrap_or(0);
        if bot_cells >= 1 && v["currentPlayerId"] == my_id.as_str() {
            break; // the bot finished a whole turn autonomously
        }
    }

    // Remove the bot: the following sync no longer lists it.
    ws.send(Message::text(
        json!({ "type": "removeBot", "playerId": bot_id }).to_string(),
    ))
    .await
    .unwrap();
    loop {
        let m = next_json(&mut ws).await;
        if m["type"] == "sync" {
            let players = m["state"]["players"].as_array().unwrap();
            if players.iter().all(|p| p["id"] != bot_id.as_str()) {
                assert_eq!(players.len(), 1);
                break;
            }
        }
    }
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn free_mode_bot_auto_rolls_and_returns_the_turn() {
    let s = Stack::start_with(&[("DICE_BOT_DELAY_MS", "10")])
        .await
        .unwrap();
    let alice = s.create("Alice").await;
    let code = alice["code"].as_str().unwrap();
    let token = alice["token"].as_str().unwrap();
    let my_id = alice["playerId"].as_str().unwrap();

    let mut ws = s.ws(code, token).await;
    assert_eq!(next_json(&mut ws).await["type"], "sync");

    ws.send(Message::text(
        json!({ "type": "addBot", "skill": "easy" }).to_string(),
    ))
    .await
    .unwrap();

    // Human rolls; the turn passes to the bot, which auto-rolls it right back.
    ws.send(Message::text(json!({ "type": "roll" }).to_string()))
        .await
        .unwrap();
    loop {
        let m = next_json(&mut ws).await;
        if m["type"] != "rolled" {
            continue;
        }
        if m["record"]["playerId"] != my_id {
            // The bot rolled on its own — and handed the turn straight back.
            assert_eq!(
                m["currentPlayerId"], my_id,
                "the bot's roll hands the turn back to the human"
            );
            break;
        }
    }
}
