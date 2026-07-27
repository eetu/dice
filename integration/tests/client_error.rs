//! `POST /api/client-error` — the browser reporting that it couldn't start. It's
//! an un-authed write on a public endpoint, so the closed-enum/rate-limit/body-cap
//! contract is the security-relevant part. `#[ignore]` (they bind a port + spawn a
//! process); run with `cargo test -p dice-integration -- --ignored`.

use dice_integration::Stack;
use serde_json::json;

/// Every kind the frontend can send must be accepted. Hand-mirrored from
/// `ReportKind` in `frontend/src/lib/report.ts` — if the two drift, reports get
/// silently 400'd exactly when something is already broken.
#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn accepts_every_kind_the_frontend_sends() {
    let s = Stack::start_with(&[("DICE_RL_CLIENT_ERR_PER_MIN", "100")])
        .await
        .unwrap();
    for kind in [
        "boot", "noEsm", "chunk", "storage", "runtime", "render", "route", "ws", "join",
    ] {
        let r = s
            .post_json(
                "/api/client-error",
                json!({ "kind": kind, "message": "x", "url": "https://x/g/ABCDE" }),
            )
            .await;
        assert_eq!(r.status(), 204, "kind {kind} was rejected");
    }
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn kind_only_is_enough() {
    let s = Stack::start().await.unwrap();
    let r = s
        .post_json("/api/client-error", json!({ "kind": "noEsm" }))
        .await;
    assert_eq!(r.status(), 204);
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn rejects_an_unknown_kind() {
    let s = Stack::start().await.unwrap();
    // `kind` becomes a metric attribute, so an open set would let anyone mint
    // label values (cardinality blow-up).
    let r = s
        .post_json("/api/client-error", json!({ "kind": "../../etc/passwd" }))
        .await;
    assert_eq!(r.status(), 400);
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn is_rate_limited_per_ip() {
    let s = Stack::start_with(&[("DICE_RL_CLIENT_ERR_PER_MIN", "2")])
        .await
        .unwrap();
    let body = json!({ "kind": "boot" });
    assert_eq!(
        s.post_json("/api/client-error", body.clone())
            .await
            .status(),
        204
    );
    assert_eq!(
        s.post_json("/api/client-error", body.clone())
            .await
            .status(),
        204
    );
    // Bucket empty — a reload loop on one broken device can't flood telemetry.
    assert_eq!(s.post_json("/api/client-error", body).await.status(), 429);
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn oversized_body_is_rejected() {
    let s = Stack::start().await.unwrap();
    // Route-scoped cap is 1 KiB (the global one is 16 KiB — too generous here).
    let r = s
        .post_json(
            "/api/client-error",
            json!({ "kind": "boot", "message": "x".repeat(4096) }),
        )
        .await;
    assert_eq!(r.status(), 413);
}
