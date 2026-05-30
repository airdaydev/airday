//! `airday status` — local-only summary. Never opens a WS.

use airday_core::LocalStorage;
use clap::Parser;
use serde::Serialize;

use crate::config::Profile;

use super::items::print_json;

#[derive(Parser, Debug)]
pub struct StatusArgs {
    #[arg(long)]
    pub json: bool,
}

#[derive(Serialize)]
struct StatusJson<'a> {
    account_id: &'a str,
    email: &'a str,
    server_url: &'a str,
    device_id: &'a str,
    last_sync_at: Option<i64>,
    last_acked_seq: u64,
    pending_changes: bool,
}

pub async fn run(args: StatusArgs) -> anyhow::Result<()> {
    let profile = Profile::require_active()?;
    let device = profile.read_device()?;
    let doc_id = uuid::Uuid::parse_str(&device.primary_doc_id)
        .map_err(|e| anyhow::anyhow!("device config has malformed primary_doc_id: {e}"))?;

    // "Pending" = unacked local ops still in the outbox (captured but
    // not yet acked by the server). Read straight from storage — no
    // need to decrypt and rebuild the whole doc.
    let storage = crate::storage::open_storage(&profile)?;
    let pending = !storage
        .outbox(airday_core::DocId(doc_id))
        .map_err(|e| anyhow::anyhow!("read outbox: {e}"))?
        .is_empty();

    if args.json {
        print_json(&StatusJson {
            account_id: &device.account_id,
            email: &device.email,
            server_url: &device.server_url,
            device_id: &device.device_id,
            last_sync_at: device.last_sync_at,
            last_acked_seq: device.last_acked_seq,
            pending_changes: pending,
        })?;
    } else {
        println!("Account: {} ({})", device.email, device.account_id);
        println!("Device:  {}", device.device_id);
        println!("Server:  {}", device.server_url);
        println!(
            "Last sync: {}",
            device
                .last_sync_at
                .map(format_relative_millis)
                .unwrap_or_else(|| "never".into())
        );
        println!("Last acked seq: {}", device.last_acked_seq);
        println!("Pending changes: {}", if pending { "yes" } else { "no" });
    }
    Ok(())
}

fn format_relative_millis(unix_millis: i64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let diff_ms = (now - unix_millis).max(0);
    let secs = diff_ms / 1000;
    if secs < 60 {
        format!("{secs}s ago")
    } else if secs < 3600 {
        format!("{}m ago", secs / 60)
    } else if secs < 86_400 {
        format!("{}h ago", secs / 3600)
    } else {
        format!("{}d ago", secs / 86_400)
    }
}
