//! SPA-serving contract: deep links get the shell, build artifacts get real
//! 404s, and caching can't strand a client on a stale shell. `#[ignore]` (they
//! bind a port + spawn a process); run with
//! `cargo test -p dice-integration -- --ignored`.

use dice_integration::Stack;

fn header(r: &reqwest::Response, name: &str) -> String {
    r.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn deep_link_serves_the_shell_uncached() {
    let s = Stack::start().await.unwrap();
    let r = s.get("/g/ABCDE").await;

    assert_eq!(r.status(), 200);
    assert!(header(&r, "content-type").starts_with("text/html"));
    // Without `no-cache` a browser can keep a shell that names chunks which no
    // longer exist — a blank page, and a reload loop via the version poll.
    assert_eq!(header(&r, "cache-control"), "no-cache");
    assert!(r.text().await.unwrap().contains("dice"));
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn missing_build_artifact_404s_instead_of_returning_html() {
    let s = Stack::start().await.unwrap();
    let r = s.get("/_app/immutable/chunks/doesnotexist12345.js").await;

    // The regression: this used to be 200 + text/html, which the browser refuses
    // to execute as a module — a blank page with nothing to report.
    assert_eq!(r.status(), 404);
    assert!(
        !header(&r, "content-type").starts_with("text/html"),
        "a dead chunk must never be served as the HTML shell"
    );
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn present_build_artifact_is_immutable() {
    let s = Stack::start().await.unwrap();
    let r = s.get("/_app/immutable/chunks/real.js").await;

    assert_eq!(r.status(), 200);
    assert!(header(&r, "content-type").contains("javascript"));
    assert_eq!(
        header(&r, "cache-control"),
        "public, max-age=31536000, immutable"
    );
}

#[tokio::test]
#[ignore = "spawns the backend binary"]
async fn unknown_non_asset_paths_still_fall_back_to_the_shell() {
    let s = Stack::start().await.unwrap();
    // Client-side routing must keep working for anything that isn't a build
    // artifact — only `_app/` is treated as "exists or 404".
    let r = s.get("/some/client/route").await;

    assert_eq!(r.status(), 200);
    assert!(header(&r, "content-type").starts_with("text/html"));
}
