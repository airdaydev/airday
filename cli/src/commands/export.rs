use std::path::{Path, PathBuf};

use airday_core::JsonExport;
use clap::Parser;

use crate::sync::Session;

#[derive(Parser, Debug)]
pub struct ExportArgs {
    /// Write the JSON export to this path instead of stdout.
    #[arg(long)]
    pub out: Option<PathBuf>,
}

pub async fn run(args: ExportArgs, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    write_export(&session.doc().export_json(), args.out.as_deref())?;

    session.flush().await?;
    Ok(())
}

pub fn write_export(export: &JsonExport, out: Option<&Path>) -> anyhow::Result<()> {
    let bytes = serde_json::to_vec_pretty(export)?;
    if let Some(path) = out {
        std::fs::write(path, bytes)?;
    } else {
        println!("{}", String::from_utf8(bytes)?);
    }
    Ok(())
}
