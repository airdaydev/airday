use std::net::SocketAddr;
use std::path::PathBuf;

use airday_server::{router, AppState};
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "airday-server", version, about = "Airday relay server")]
struct Cli {
    /// Path to the sqlite database file.
    #[arg(long, default_value = "airday.sqlite")]
    db: PathBuf,

    /// Address to bind.
    #[arg(long, default_value = "127.0.0.1:8080")]
    bind: SocketAddr,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    let state = AppState::open(&cli.db).await?;
    let app = router(state);

    let listener = tokio::net::TcpListener::bind(cli.bind).await?;
    tracing::info!(addr = %listener.local_addr()?, "airday-server listening");
    axum::serve(listener, app).await?;
    Ok(())
}
