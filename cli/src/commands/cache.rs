//! `airday cache` — local cache inspection and reset. Local-only; never opens a WS.

use std::io::IsTerminal;

use airday_core::LocalStorage;
use clap::{Parser, Subcommand};
use dialoguer::Confirm;
use serde::Serialize;

use crate::config::Profile;

use super::items::print_json;

#[derive(Parser, Debug)]
#[command(subcommand_required = true, arg_required_else_help = true)]
pub struct CacheArgs {
    #[command(subcommand)]
    pub cmd: CacheCmd,
}

#[derive(Subcommand, Debug)]
pub enum CacheCmd {
    /// Show cache location and size.
    Status {
        #[arg(long)]
        json: bool,
    },
    /// Delete the local doc cache and reset the sync cursor. The next
    /// `airday sync` will rehydrate from the server.
    Clear {
        /// Skip the confirmation prompt when there are unsynced ops.
        #[arg(long)]
        force: bool,
    },
}

pub async fn run(args: CacheArgs) -> anyhow::Result<()> {
    match args.cmd {
        CacheCmd::Status { json } => status(json).await,
        CacheCmd::Clear { force } => clear(force).await,
    }
}

#[derive(Serialize)]
struct CacheStatusJson<'a> {
    profile_dir: &'a str,
    doc_path: &'a str,
    doc_bytes: Option<u64>,
}

async fn status(json: bool) -> anyhow::Result<()> {
    let profile = Profile::require_active()?;
    let doc_path = profile.doc_path();
    let doc_bytes = std::fs::metadata(&doc_path).ok().map(|m| m.len());

    if json {
        print_json(&CacheStatusJson {
            profile_dir: profile.dir.to_string_lossy().as_ref(),
            doc_path: doc_path.to_string_lossy().as_ref(),
            doc_bytes,
        })?;
    } else {
        println!("Profile dir: {}", profile.dir.display());
        println!("Doc file:    {}", doc_path.display());
        println!(
            "Doc size:    {}",
            doc_bytes.map(format_bytes).unwrap_or_else(|| "—".into())
        );
    }
    Ok(())
}

async fn clear(force: bool) -> anyhow::Result<()> {
    let profile = Profile::require_active()?;
    let doc_path = profile.doc_path();

    // Unacked local ops in the outbox would be lost by a cache wipe.
    // Scope the storage handle so its sqlite connection is dropped
    // before we unlink the file below.
    let pending = if doc_path.exists() {
        let device = profile.read_device()?;
        let doc_id = uuid::Uuid::parse_str(&device.primary_doc_id)
            .map_err(|e| anyhow::anyhow!("device config has malformed primary_doc_id: {e}"))?;
        let storage = crate::storage::open_storage(&profile)?;
        !storage
            .outbox(airday_core::DocId(doc_id))
            .map_err(|e| anyhow::anyhow!("read outbox: {e}"))?
            .is_empty()
    } else {
        false
    };

    if pending && !force {
        if !std::io::stdin().is_terminal() {
            anyhow::bail!(
                "local cache has unsynced changes; run `airday sync` first or pass --force"
            );
        }
        let proceed = Confirm::new()
            .with_prompt("Local cache has unsynced changes that will be lost. Clear anyway?")
            .default(false)
            .interact()?;
        if !proceed {
            println!("aborted");
            return Ok(());
        }
    }

    if doc_path.exists() {
        // Nuke the sqlite db file and its WAL/shm sidecars. The next
        // sync rehydrates from the server. If `read_doc` above already
        // opened a connection, it stays alive against the unlinked
        // inode until the profile drops — harmless on unix.
        std::fs::remove_file(&doc_path)?;
        for suffix in ["-wal", "-shm"] {
            let sidecar = doc_path.with_file_name(format!(
                "{}{suffix}",
                doc_path.file_name().unwrap().to_string_lossy()
            ));
            let _ = std::fs::remove_file(sidecar);
        }
    }

    let mut device = profile.read_device()?;
    if device.last_acked_seq != 0 {
        device.last_acked_seq = 0;
        profile.write_device(&device)?;
    }

    println!("Cache cleared. Run `airday sync` to rehydrate.");
    Ok(())
}

fn format_bytes(n: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if n >= GB {
        format!("{:.2} GiB", n as f64 / GB as f64)
    } else if n >= MB {
        format!("{:.2} MiB", n as f64 / MB as f64)
    } else if n >= KB {
        format!("{:.1} KiB", n as f64 / KB as f64)
    } else {
        format!("{n} B")
    }
}
