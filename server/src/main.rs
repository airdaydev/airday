use std::net::SocketAddr;
use std::path::PathBuf;

use airday_server::{build_info, router, AppState, Config};
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "airday-server", version, about = "Airday relay server")]
struct Cli {
    /// Path to a TOML config file. Defaults to ./config.toml; missing file → defaults.
    #[arg(long)]
    config: Option<PathBuf>,

    /// Path to the sqlite database file. Overrides the config file.
    #[arg(long)]
    db: Option<PathBuf>,

    /// Address to bind. Overrides the config file.
    #[arg(long)]
    bind: Option<SocketAddr>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let (mut cfg, cfg_source) = Config::load(cli.config.as_deref());

    if let Some(db) = cli.db {
        cfg.db = db;
    }
    if let Some(bind) = cli.bind {
        cfg.bind = bind.to_string();
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&cfg.log_level)),
        )
        .init();

    cfg_source.log();

    if let Some(parent) = cfg.db.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let state = AppState::open(&cfg.db)
        .await?
        .with_secure_cookies(cfg.secure_cookies)
        .with_snapshot_threshold_blobs(cfg.snapshot_threshold_blobs);
    let app = router(state);

    let addr = cfg.bind_addr()?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!(
        addr = %listener.local_addr()?,
        build.git_sha = build_info::GIT_SHA,
        "airday-server listening"
    );
    axum::serve(listener, app).await?;
    Ok(())
}
