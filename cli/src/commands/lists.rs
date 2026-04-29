//! List management: list (default action), add, rename, rm.

use airday_core::ListView;
use clap::{Parser, Subcommand};
use serde::Serialize;

use crate::sync::Session;

use super::items::print_json;
use super::resolve::{resolve_list_id, short_id};

#[derive(Parser, Debug)]
pub struct ListsArgs {
    #[command(subcommand)]
    pub cmd: Option<ListsCmd>,
    #[arg(long, global = true)]
    pub json: bool,
}

#[derive(Subcommand, Debug)]
pub enum ListsCmd {
    /// Add a new list.
    Add { name: String },
    /// Rename an existing list (built-ins included).
    Rename { list: String, name: String },
    /// Delete a user-created list. Items are reassigned to `current`.
    Rm { list: String },
}

pub async fn run(args: ListsArgs, offline: bool) -> anyhow::Result<()> {
    match args.cmd {
        None => show(args.json, offline).await,
        Some(ListsCmd::Add { name }) => add(&name, offline).await,
        Some(ListsCmd::Rename { list, name }) => rename(&list, &name, offline).await,
        Some(ListsCmd::Rm { list }) => rm(&list, offline).await,
    }
}

async fn show(json: bool, offline: bool) -> anyhow::Result<()> {
    let session = Session::open(offline).await?;
    let lists = session.doc().all_lists();
    if json {
        print_json(&lists.iter().map(list_json).collect::<Vec<_>>())?;
    } else {
        for l in &lists {
            println!("{}  {}", short_id(&l.id), l.name);
        }
    }
    session.flush().await?;
    Ok(())
}

async fn add(name: &str, offline: bool) -> anyhow::Result<()> {
    let session = Session::open(offline).await?;
    let id = session.doc().add_list(name)?;
    session.flush().await?;
    println!("{}", short_id(&id));
    Ok(())
}

async fn rename(list_prefix: &str, name: &str, offline: bool) -> anyhow::Result<()> {
    let session = Session::open(offline).await?;
    let id = resolve_list_id(session.doc(), list_prefix)?;
    session.doc().rename_list(&id, name)?;
    session.flush().await?;
    println!("{}", short_id(&id));
    Ok(())
}

async fn rm(list_prefix: &str, offline: bool) -> anyhow::Result<()> {
    let session = Session::open(offline).await?;
    let id = resolve_list_id(session.doc(), list_prefix)?;
    session.doc().delete_list(&id)?;
    session.flush().await?;
    println!("{}", short_id(&id));
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
