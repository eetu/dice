//! WebSocket close codes. The client BRANCHES on these: "this game is gone" and
//! "your saved seat isn't in this game" need different handling (a dead end vs a
//! rejoin), and a bare `Close(None)` couldn't tell them apart. `#[ignore]` (they
//! bind a port + spawn a process); run with
//! `cargo test -p dice-integration -- --ignored`.

use dice_integration::{Stack, Ws};
use futures_util::StreamExt;
use tokio_tungstenite::tungstenite::Message;

/// The close code the server sent, skipping any data frames before it.
async fn close_code(ws: &mut Ws) -> u16 {
    loop {
        let msg = ws.next().await.expect("stream ended").expect("ws error");
        if let Message::Close(frame) = msg {
            return u16::from(frame.expect("close frame with a code").code);
        }
    }
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn unknown_room_closes_with_4404() {
    let s = Stack::start().await.unwrap();
    let mut ws = s.ws("ZZZZZ", "irrelevant").await;
    assert_eq!(close_code(&mut ws).await, 4404);
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn stale_token_on_a_live_room_closes_with_4401() {
    let s = Stack::start().await.unwrap();
    let alice = s.create("Alice").await;
    let code = alice["code"].as_str().unwrap();

    // The room is very much alive — only the token is wrong. Reporting this as
    // "the game expired" (which one shared close code forced) sent the player to
    // a dead end instead of rejoining them.
    let mut ws = s.ws(code, "not-a-real-token").await;
    assert_eq!(close_code(&mut ws).await, 4401);
}
