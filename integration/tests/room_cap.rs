//! What happens at `DICE_MAX_ROOMS`. Rooms live a day now, and a closed tab never
//! sends `leave`, so the table fills with abandoned games — refusing every new
//! game until the reaper catches up would be the wrong answer. `#[ignore]` (they
//! bind a port + spawn a process); run with
//! `cargo test -p dice-integration -- --ignored`.

use dice_integration::Stack;
use futures_util::StreamExt;
use serde_json::json;

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn at_the_cap_an_abandoned_room_is_evicted_for_a_new_one() {
    // Cap of 2, so the third create has to make space.
    let s = Stack::start_with(&[("DICE_MAX_ROOMS", "2")]).await.unwrap();

    let first = s.create("Alice").await;
    let first_code = first["code"].as_str().unwrap().to_string();
    let second = s.create("Bob").await;
    let second_code = second["code"].as_str().unwrap().to_string();

    // Nobody ever connected a socket, so both are abandoned. The third create
    // must succeed by evicting the stalest (the first).
    let third = s.post_json("/api/games", json!({ "name": "Carol" })).await;
    assert_eq!(
        third.status(),
        200,
        "create at the cap should evict, not 503"
    );

    assert_eq!(
        s.get(&format!("/api/games/{first_code}")).await.status(),
        404,
        "the stalest abandoned room should be the one evicted"
    );
    assert_eq!(
        s.get(&format!("/api/games/{second_code}")).await.status(),
        200,
        "the newer room must survive"
    );
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn a_room_someone_is_connected_to_is_never_evicted() {
    let s = Stack::start_with(&[("DICE_MAX_ROOMS", "1")]).await.unwrap();

    let alice = s.create("Alice").await;
    let code = alice["code"].as_str().unwrap().to_string();
    let token = alice["token"].as_str().unwrap();

    // Alice is actually present, so the only room is not evictable and the cap
    // does its real job: refuse.
    let mut ws = s.ws(&code, token).await;
    let _ = ws.next().await; // the sync frame — she is now `connected`

    let denied = s.post_json("/api/games", json!({ "name": "Bob" })).await;
    assert_eq!(
        denied.status(),
        503,
        "must not evict a room being played in"
    );
    assert_eq!(
        s.get(&format!("/api/games/{code}")).await.status(),
        200,
        "Alice's game must still be there"
    );

    // Once she is gone, the slot frees up again on the next create.
    drop(ws);
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        if s.post_json("/api/games", json!({ "name": "Bob" }))
            .await
            .status()
            == 200
        {
            return;
        }
    }
    panic!("create never succeeded after the only player disconnected");
}
