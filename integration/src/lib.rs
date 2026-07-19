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
        // A stub dist/ so serve_spa's index.html fallback resolves.
        let static_tmp = tempfile::tempdir()?;
        std::fs::write(
            static_tmp.path().join("index.html"),
            "<html><body>dice</body></html>",
        )?;

        let port = free_port()?;
        let base = format!("http://127.0.0.1:{port}");

        let child = Command::new(bin_path())
            .env("DICE_BIND", format!("127.0.0.1:{port}"))
            .env("STATIC_DIR", static_tmp.path())
            .env("RUST_LOG", "warn")
            .spawn()?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;

        let mut up = false;
        for _ in 0..200 {
            if let Ok(r) = client.get(format!("{base}/status")).send().await {
                if r.status().is_success() {
                    up = true;
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let stack = Stack {
            child,
            base,
            port,
            client,
            _static_tmp: static_tmp,
        };
        if !up {
            anyhow::bail!("backend did not come up within 10s");
        }
        Ok(stack)
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
        let url = format!("ws://127.0.0.1:{}/ws/games/{code}?token={token}", self.port);
        let (stream, _resp) = connect_async(url).await.expect("ws connect");
        stream
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
