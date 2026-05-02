//! Bin namespace + `bin <id>` action.
//!
//! `airday bin <id>` (the verb) lives in [`super::items::bin`]; this
//! module owns the namespace operations and the dispatcher that picks
//! between them. Clap's `external_subcommand` captures any token that
//! isn't a known sub-subcommand, which we then treat as an item id
//! and route to the verb.

use clap::{Parser, Subcommand};
use serde::Serialize;

use crate::sync::Session;

use super::items::{print_json, IdArg};

#[derive(Parser, Debug)]
pub struct BinArgs {
    #[command(subcommand)]
    pub sub: BinSub,
    #[arg(long, global = true)]
    pub json: bool,
}

#[derive(Subcommand, Debug)]
pub enum BinSub {
    /// Show items in the bin.
    Show,
    /// Hard-delete every binned item.
    Empty,
    /// Hard-delete a single binned item.
    Rm(IdArg),
    /// Anything else is treated as an item id to bin.
    #[command(external_subcommand)]
    Item(Vec<String>),
}

pub async fn run(args: BinArgs, offline: bool) -> anyhow::Result<()> {
    match args.sub {
        BinSub::Show => show(args.json, offline).await,
        BinSub::Empty => empty(offline).await,
        BinSub::Rm(id) => rm(&id.item_id, offline).await,
        BinSub::Item(tokens) => match tokens.as_slice() {
            [id] => {
                super::items::bin(
                    IdArg {
                        item_id: id.clone(),
                    },
                    offline,
                )
                .await
            }
            [] => anyhow::bail!("expected an item id; try `airday bin show`"),
            _ => anyhow::bail!("unexpected extra arguments after item id"),
        },
    }
}

async fn show(json: bool, offline: bool) -> anyhow::Result<()> {
    let session = Session::open(offline).await?;
    let items = session.doc().binned_items();
    if json {
        let v: Vec<BinnedJson> = items
            .iter()
            .map(|i| BinnedJson {
                id: &i.id,
                text: &i.text,
                list_id: &i.list_id,
                binned_at: i.binned_at.unwrap_or_default(),
            })
            .collect();
        print_json(&v)?;
    } else {
        for i in &items {
            println!("{}  {}", i.id, i.text);
        }
    }
    session.flush().await?;
    Ok(())
}

async fn empty(offline: bool) -> anyhow::Result<()> {
    let session = Session::open(offline).await?;
    let removed = session.doc().empty_bin()?;
    session.flush().await?;
    println!("removed {removed}");
    Ok(())
}

async fn rm(item_id: &str, offline: bool) -> anyhow::Result<()> {
    let session = Session::open(offline).await?;
    session.doc().delete_binned(item_id)?;
    session.flush().await?;
    println!("{item_id}");
    Ok(())
}

#[derive(Serialize)]
struct BinnedJson<'a> {
    id: &'a str,
    text: &'a str,
    list_id: &'a str,
    binned_at: i64,
}
