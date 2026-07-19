#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dice_backend::run_server().await
}
