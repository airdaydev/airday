//! `airday sync` — explicit pull + push, no doc mutation.
//!
//! Unlike the per-command `--sync` flag (which falls back to local-only
//! on connect failure), this command treats a failed connect as a hard
//! error: the user explicitly asked for a sync, so silently doing
//! nothing would be a lie.

use crate::sync::Session;

pub async fn run() -> anyhow::Result<()> {
    let session = Session::open(true).await?;
    if !session.is_online() {
        anyhow::bail!("could not reach server");
    }
    session.flush().await?;
    println!("Synced.");
    Ok(())
}
