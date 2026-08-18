//! List management: list (default action), add, rename, archive/unarchive.
//!
//! There is deliberately no user-facing delete (`spec/cli.md`): archive
//! is the only way to remove a list from the active workspace. The
//! core's destructive `delete_list` stays internal.

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
    /// Show lists. Active lists by default; `--archived` shows only
    /// archived lists, `--all` shows both.
    Ls {
        #[arg(long)]
        json: bool,
        /// Show only archived lists.
        #[arg(long, conflicts_with = "all")]
        archived: bool,
        /// Show active and archived lists.
        #[arg(long)]
        all: bool,
    },
    /// Add a new list.
    Add { name: String },
    /// Rename a user-created list. The reserved `inbox` list is not
    /// renamable from the doc layer (its label is client-side until a
    /// meta CRDT lands).
    Rename { list: String, name: String },
    /// Archive a user-created list: removes it from the active
    /// workspace without touching its items, ordering, or metadata
    /// (`spec/data-model.md` "Archived lists").
    Archive { list: String },
    /// Restore an archived list to the active workspace.
    Unarchive { list: String },
}

pub async fn run(args: ListsArgs, sync: bool) -> anyhow::Result<()> {
    match args.cmd {
        ListsCmd::Ls {
            json,
            archived,
            all,
        } => show(json, archived, all, sync).await,
        ListsCmd::Add { name } => add(&name, sync).await,
        ListsCmd::Rename { list, name } => rename(&list, &name, sync).await,
        ListsCmd::Archive { list } => set_archived(&list, true, sync).await,
        ListsCmd::Unarchive { list } => set_archived(&list, false, sync).await,
    }
}

async fn show(json: bool, archived_only: bool, all: bool, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    let lists: Vec<ListView> = session
        .doc()
        .all_lists()
        .into_iter()
        .filter(|l| all || (l.archived_at.is_some() == archived_only))
        .collect();
    if json {
        print_json(&lists.iter().map(list_json).collect::<Vec<_>>())?;
    } else {
        for l in &lists {
            if l.archived_at.is_some() {
                println!("{}  {}  (archived)", l.id, l.name);
            } else {
                println!("{}  {}", l.id, l.name);
            }
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

async fn set_archived(list_id: &str, archived: bool, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    session.doc().set_list_archived(list_id, archived)?;
    session.flush().await?;
    println!("{list_id}");
    Ok(())
}

#[derive(Serialize)]
struct ListJson<'a> {
    id: &'a str,
    name: &'a str,
    archived_at: Option<i64>,
    created_at: i64,
}

fn list_json(l: &ListView) -> ListJson<'_> {
    ListJson {
        id: &l.id,
        name: &l.name,
        archived_at: l.archived_at,
        created_at: l.created_at,
    }
}
