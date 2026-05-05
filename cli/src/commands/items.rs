//! Item commands: add / ls / done / bin (verb) / restore / mv / edit.
//!
//! Every action goes through `Session` (open → mutate → flush). The
//! session reads from and writes to the local Loro doc; it only talks
//! to the server when `-s/--sync` is passed (or `airday sync` is run
//! separately).

use std::io::{BufRead, IsTerminal};

use airday_core::{ItemView, LIST_MAIN};
use clap::Parser;
use serde::Serialize;

use crate::sync::Session;

// ---------- add ----------

#[derive(Parser, Debug)]
pub struct AddArgs {
    /// Item text. Use `-` to read one item per non-blank line from stdin.
    pub text: String,
    /// Target list. Defaults to `main`.
    #[arg(long, default_value = LIST_MAIN)]
    pub list: String,
}

pub async fn add(args: AddArgs, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    let texts = collect_texts(&args.text)?;
    if texts.is_empty() {
        anyhow::bail!("no item text provided");
    }
    let mut ids = Vec::with_capacity(texts.len());
    for text in &texts {
        ids.push(session.doc().add_item(&args.list, text)?);
    }
    session.flush().await?;
    for id in ids {
        println!("{id}");
    }
    Ok(())
}

fn collect_texts(arg: &str) -> anyhow::Result<Vec<String>> {
    if arg == "-" {
        let stdin = std::io::stdin();
        if stdin.is_terminal() {
            anyhow::bail!(
                "`add -` reads from stdin but stdin is a tty — pipe input or pass text directly"
            );
        }
        let mut out = Vec::new();
        for line in stdin.lock().lines() {
            let line = line?;
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
        }
        Ok(out)
    } else {
        Ok(vec![arg.to_string()])
    }
}

// ---------- ls ----------

#[derive(Parser, Debug)]
pub struct LsArgs {
    /// List to show. Defaults to `main`.
    #[arg(long, default_value = LIST_MAIN)]
    pub list: String,
    /// Include items marked `Done`.
    #[arg(long)]
    pub done: bool,
    /// Machine-parseable output.
    #[arg(long)]
    pub json: bool,
}

pub async fn ls(args: LsArgs, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    let mut items = session.doc().items_in_list(&args.list, false);
    if !args.done {
        items.retain(|i| !i.is_done());
    }
    if args.json {
        print_json(&items.iter().map(item_json).collect::<Vec<_>>())?;
    } else {
        print_items(&items);
    }
    session.flush().await?;
    Ok(())
}

#[derive(Serialize)]
struct ItemJson<'a> {
    id: &'a str,
    text: &'a str,
    list_id: &'a str,
    created_at: i64,
    done_at: Option<i64>,
    binned_at: Option<i64>,
}

fn item_json(item: &ItemView) -> ItemJson<'_> {
    ItemJson {
        id: &item.id,
        text: &item.text,
        list_id: &item.list_id,
        created_at: item.created_at,
        done_at: item.done_at,
        binned_at: item.binned_at,
    }
}

fn print_items(items: &[ItemView]) {
    for item in items {
        // Two slots so done+binned can both show. `~` (binned) takes
        // precedence in the box; done is a trailing `(done)` tag for
        // items that are also binned.
        let mark = if item.is_binned() {
            "~"
        } else if item.is_done() {
            "x"
        } else {
            " "
        };
        let suffix = if item.is_binned() && item.is_done() {
            " (done)"
        } else {
            ""
        };
        println!("{}  [{mark}] {}{suffix}", item.id, item.text);
    }
}

pub fn print_json<T: Serialize>(value: &T) -> anyhow::Result<()> {
    let s = serde_json::to_string_pretty(value)?;
    println!("{s}");
    Ok(())
}

// ---------- done / bin / restore ----------

#[derive(Parser, Debug)]
pub struct IdArg {
    pub item_id: String,
}

pub async fn done(args: IdArg, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    session.doc().set_item_done(&args.item_id, true)?;
    session.flush().await?;
    println!("{}", args.item_id);
    Ok(())
}

pub async fn bin(args: IdArg, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    session.doc().set_item_binned(&args.item_id, true)?;
    session.flush().await?;
    println!("{}", args.item_id);
    Ok(())
}

/// Restore from the bin. Done state is preserved — a done-then-binned
/// item pops back into the Done view, a plain binned item back into
/// its list. Use a follow-up command to toggle done off if needed.
pub async fn restore(args: IdArg, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    session.doc().set_item_binned(&args.item_id, false)?;
    session.flush().await?;
    println!("{}", args.item_id);
    Ok(())
}

// ---------- mv ----------

#[derive(Parser, Debug)]
pub struct MvArgs {
    pub item_id: String,
    pub list: String,
}

pub async fn mv(args: MvArgs, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    // Append at the end of the target list (target_index = current
    // length). `move_item` clamps to the existing range, so passing a
    // huge index is safe — but the explicit count here is clearer.
    let target_idx = session.doc().items_in_list(&args.list, true).len();
    session
        .doc()
        .move_item(&args.item_id, &args.list, target_idx)?;
    session.flush().await?;
    println!("{}", args.item_id);
    Ok(())
}

// ---------- edit ----------

#[derive(Parser, Debug)]
pub struct EditArgs {
    pub item_id: String,
    pub text: String,
}

pub async fn edit(args: EditArgs, sync: bool) -> anyhow::Result<()> {
    let session = Session::open(sync).await?;
    session.doc().edit_item_text(&args.item_id, &args.text)?;
    session.flush().await?;
    println!("{}", args.item_id);
    Ok(())
}
