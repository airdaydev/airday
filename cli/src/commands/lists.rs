//! List management: list (default action), add, rename, rm.

use airday_core::ListView;
use clap::{Parser, Subcommand};
use serde::Serialize;

use crate::sync::Session;

use super::items::print_json;

#[derive(Parser, Debug)]
#[command(subcommand_required = true, arg_required_else_help = true)]
pub struct ListsArgs {
    #[command(subcommand)]
    pub cmd: ListsCmd,
}

#[derive(Subcommand, Debug)]
pub enum ListsCmd {
    /// Show all lists.
    Ls {
        #[arg(long)]
        json: bool,
    },
    /// Add a new list.
    Add { name: String },
    /// Rename a user-created list. The reserved `main` list is not
    /// renamable from the doc layer (its label is client-side until a
    /// meta CRDT lands).
    Rename { list: String, name: String },
    /// Delete a user-created list. Items are reassigned to `current`.
    Rm { list: String },
}

pub async fn run(args: ListsArgs, sync: bool) -> anyhow::Result<()> {
    match args.cmd {
        ListsCmd::Ls { json } => show(json, sync).await,
        ListsCmd::Add { name } => add(&name, sync).await,
        ListsCmd::Rename { list, name } => rename(&list, &name, sync).await,
        ListsCmd::Rm { list } => rm(&list, sync).await,
    }
}

async fn show(json: bool, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    let lists = session.doc().all_lists();
    if json {
        print_json(&lists.iter().map(list_json).collect::<Vec<_>>())?;
    } else {
        for l in &lists {
            println!("{}  {}", l.id, l.name);
        }
    }
    session.flush().await?;
    Ok(())
}

async fn add(name: &str, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    let id = session.doc().add_list(name)?;
    session.flush().await?;
    println!("{id}");
    Ok(())
}

async fn rename(list_id: &str, name: &str, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    session.doc().rename_list(list_id, name)?;
    session.flush().await?;
    println!("{list_id}");
    Ok(())
}

async fn rm(list_id: &str, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    session.doc().delete_list(list_id)?;
    session.flush().await?;
    println!("{list_id}");
    Ok(())
}

#[derive(Serialize)]
struct ListJson<'a> {
    id: &'a str,
    name: &'a str,
    created_at: i64,
}

fn list_json(l: &ListView) -> ListJson<'_> {
    ListJson {
        id: &l.id,
        name: &l.name,
        created_at: l.created_at,
    }
}
