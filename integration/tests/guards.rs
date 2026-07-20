//! Abuse-guard integration tests: prove the per-IP limits actually shed load on
//! the real binary. `#[ignore]` (they spawn a process + bind a port); run with
//! `cargo test -p dice-integration -- --ignored`.

use dice_integration::{Stack, Ws};
use serde_json::json;
use tokio_tungstenite::tungstenite::Error as WsError;

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn create_rate_limit_returns_429() {
    // Tight per-IP create budget so the burst is exhausted in a few calls.
    let s = Stack::start_with(&[("DICE_RL_CREATE_PER_MIN", "3")])
        .await
        .unwrap();

    // Burst of 3 (capacity == per-minute) is allowed from this one IP...
    for i in 0..3 {
        let r = s.post_json("/api/games", json!({ "name": "x" })).await;
        assert!(r.status().is_success(), "create #{i} → {}", r.status());
    }
    // ...the next is throttled.
    let r = s.post_json("/api/games", json!({ "name": "x" })).await;
    assert_eq!(r.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn ws_per_ip_cap_rejects_extra_sockets() {
    let s = Stack::start_with(&[("DICE_WS_PER_IP", "2")]).await.unwrap();
    let game = s.create("Alice").await;
    let code = game["code"].as_str().unwrap();
    let token = game["token"].as_str().unwrap();

    // Hold two sockets open (permits stay taken while these live).
    let _held: Vec<Ws> = vec![
        s.ws(code, token).await,
        s.try_ws(code, token).await.expect("second socket allowed"),
    ];

    // The third from the same IP is rejected at the handshake with 429.
    match s.try_ws(code, token).await {
        Err(WsError::Http(resp)) => assert_eq!(resp.status().as_u16(), 429),
        other => panic!("expected 429 handshake rejection, got {other:?}"),
    }
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn body_limit_rejects_oversized_post() {
    let s = Stack::start().await.unwrap();
    // A name far larger than the 16 KiB body cap → the request is rejected before
    // it can allocate/parse (413 Payload Too Large).
    let big = "z".repeat(64 * 1024);
    let r = s.post_json("/api/games", json!({ "name": big })).await;
    assert_eq!(r.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
}
