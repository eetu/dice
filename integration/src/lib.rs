//! Integration harness: spawns the real `dice-backend` binary against a stub
//! `dist/`, polls `/status` until up, exposes a `reqwest` client + REST/WS
//! helpers, and kills the child on `Drop`. Tests under `integration/tests/*.rs`
//! are `#[ignore]` (they spawn a process + bind a port) — run with
//! `cargo test -p dice-integration -- --ignored`.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::time::Duration;

use serde_json::Value;
use tempfile::TempDir;
use tokio::net::TcpStream;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

pub type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub struct Stack {
    child: Child,
    pub base: String,
    pub port: u16,
    pub client: reqwest::Client,
    _static_tmp: TempDir,
}

impl Stack {
    pub async fn start() -> anyhow::Result<Self> {
        Self::start_with(&[]).await
    }

    /// Start the backend with extra environment (e.g. tuned abuse-guard caps).
    pub async fn start_with(env: &[(&str, &str)]) -> anyhow::Result<Self> {
        // A stub dist/ so serve_spa's index.html fallback resolves.
        let static_tmp = tempfile::tempdir()?;
        std::fs::write(
            static_tmp.path().join("index.html"),
            "<html><body>dice</body></html>",
        )?;
        // …plus one hashed build artifact, so the SPA-serving tests can tell a
        // present asset (immutable) from a missing one (404, never the shell).
        let app_dir = static_tmp.path().join("_app/immutable/chunks");
        std::fs::create_dir_all(&app_dir)?;
        std::fs::write(app_dir.join("real.js"), "export const x = 1;\n")?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;

        // `free_port` can only reserve a port by binding then releasing it, so two
        // stacks starting concurrently can pick the same number and one loses the
        // race to bind (it exits, and we'd wait out the poll for nothing). Retry
        // on a fresh port instead of failing the test — the whole `#[ignore]`d
        // suite spawns a backend per test, so this is a routine collision.
        let mut last_err = String::from("backend did not come up");
        for _ in 0..3 {
            let port = free_port()?;
            let base = format!("http://127.0.0.1:{port}");

            let mut cmd = Command::new(bin_path());
            cmd.env("DICE_BIND", format!("127.0.0.1:{port}"))
                .env("STATIC_DIR", static_tmp.path())
                .env("RUST_LOG", "warn");
            for (k, v) in env {
                cmd.env(k, v);
            }
            let mut child = cmd.spawn()?;

            let mut up = false;
            for _ in 0..100 {
                if let Ok(r) = client.get(format!("{base}/status")).send().await {
                    if r.status().is_success() {
                        up = true;
                        break;
                    }
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            if up {
                return Ok(Stack {
                    child,
                    base,
                    port,
                    client,
                    _static_tmp: static_tmp,
                });
            }
            let _ = child.kill();
            let _ = child.wait();
            last_err = format!("backend on :{port} did not come up within 5s");
        }
        anyhow::bail!("{last_err}")
    }

    /// Stop the backend GRACEFULLY (SIGTERM), so it flushes `DICE_STATE_FILE` on
    /// shutdown, and reap it. Used by the persistence restart test — the normal
    /// `Drop` path SIGKILLs, which skips the flush. Idempotent with `Drop` (the
    /// second `wait`/`kill` there just errors harmlessly on the reaped child).
    pub fn shutdown_graceful(&mut self) {
        let _ = Command::new("kill")
            .arg("-TERM")
            .arg(self.child.id().to_string())
            .status();
        let _ = self.child.wait();
    }

    pub async fn get(&self, route: &str) -> reqwest::Response {
        self.client
            .get(format!("{}{route}", self.base))
            .send()
            .await
            .expect("request failed")
    }

    pub async fn post_json(&self, route: &str, body: Value) -> reqwest::Response {
        self.client
            .post(format!("{}{route}", self.base))
            .json(&body)
            .send()
            .await
            .expect("request failed")
    }

    /// Create a game, returning its JSON `{ code, playerId, token }`.
    pub async fn create(&self, name: &str) -> Value {
        let r = self
            .post_json("/api/games", serde_json::json!({ "name": name }))
            .await;
        assert!(r.status().is_success(), "create → {}", r.status());
        r.json().await.expect("json")
    }

    /// Open a player's WebSocket.
    pub async fn ws(&self, code: &str, token: &str) -> Ws {
        self.try_ws(code, token).await.expect("ws connect")
    }

    /// Open a WebSocket, surfacing the handshake error (e.g. a 429 when over the
    /// per-IP connection cap) instead of panicking.
    pub async fn try_ws(
        &self,
        code: &str,
        token: &str,
    ) -> Result<Ws, tokio_tungstenite::tungstenite::Error> {
        let url = format!("ws://127.0.0.1:{}/ws/games/{code}?token={token}", self.port);
        connect_async(url).await.map(|(stream, _resp)| stream)
    }
}

impl Drop for Stack {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn free_port() -> anyhow::Result<u16> {
    let l = TcpListener::bind("127.0.0.1:0")?;
    Ok(l.local_addr()?.port())
}

/// Resolve the sibling `dice-backend` binary next to the test runner.
fn bin_path() -> PathBuf {
    let mut p = std::env::current_exe().expect("current_exe");
    p.pop();
    if p.ends_with("deps") {
        p.pop();
    }
    p.join("dice-backend")
}
