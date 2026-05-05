use clap::{Parser, Subcommand};
use dialoguer::Password;

pub const MIN_PASSWORD_LEN: usize = 10;

pub mod bin;
pub mod cache;
pub mod items;
pub mod lists;
mod login;
mod logout;
mod password;
mod recover;
mod signup;
pub mod status;
mod sync;

const DEFAULT_SERVER: &str = "http://127.0.0.1:8000";

#[derive(Parser, Debug)]
#[command(name = "airday", version, about = "Airday CLI")]
pub struct Cli {
    /// Connect to the server before running this command: pull peer
    /// ops first, then push any pending local ops on exit. Without
    /// this flag, commands operate against the local doc only.
    /// Equivalent to setting `AIRDAY_SYNC=1`.
    #[arg(long, short = 's', global = true)]
    sync: bool,

    #[command(subcommand)]
    cmd: Cmd,
}

impl Cli {
    pub fn sync(&self) -> bool {
        self.sync
    }
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Create a new account on the given server.
    Signup(signup::Args),
    /// Log in to an existing account on a fresh device.
    Login(login::Args),
    /// Wipe local state. Does not revoke the device server-side.
    Logout,
    /// Use a recovery code to set a new password and bootstrap a fresh device.
    Recover(recover::Args),
    /// Change the password on the active account.
    Password,
    /// Add an item.
    Add(items::AddArgs),
    /// List items.
    Ls(items::LsArgs),
    /// Mark an item done.
    Done(items::IdArg),
    /// Send an item to the bin (or operate on the bin namespace).
    Bin(bin::BinArgs),
    /// Restore an item from done/bin to live.
    Restore(items::IdArg),
    /// Move an item to a different list.
    Mv(items::MvArgs),
    /// Edit an item's text.
    Edit(items::EditArgs),
    /// Manage lists.
    Lists(lists::ListsArgs),
    /// Inspect the local cache.
    Cache(cache::CacheArgs),
    /// Show local sync state.
    Status(status::StatusArgs),
    /// Pull peer ops and push any pending local ops, then exit.
    Sync,
}

impl Cli {
    pub async fn run(self) -> anyhow::Result<()> {
        let sync = self.sync();
        match self.cmd {
            Cmd::Signup(a) => signup::run(a).await,
            Cmd::Login(a) => login::run(a).await,
            Cmd::Logout => logout::run().await,
            Cmd::Recover(a) => recover::run(a).await,
            Cmd::Password => password::run().await,
            Cmd::Add(a) => items::add(a, sync).await,
            Cmd::Ls(a) => items::ls(a, sync).await,
            Cmd::Done(a) => items::done(a, sync).await,
            Cmd::Bin(a) => bin::run(a, sync).await,
            Cmd::Restore(a) => items::restore(a, sync).await,
            Cmd::Mv(a) => items::mv(a, sync).await,
            Cmd::Edit(a) => items::edit(a, sync).await,
            Cmd::Lists(a) => lists::run(a, sync).await,
            Cmd::Cache(a) => cache::run(a).await,
            Cmd::Status(a) => status::run(a).await,
            Cmd::Sync => sync::run().await,
        }
    }
}

pub fn default_device_name() -> String {
    gethostname::gethostname()
        .into_string()
        .unwrap_or_else(|_| "airday-cli".to_string())
}

pub fn default_server() -> String {
    std::env::var("AIRDAY_SERVER").unwrap_or_else(|_| DEFAULT_SERVER.to_string())
}

/// Prompt for a new password with confirmation and the minimum-length rule.
pub fn prompt_new_password(prompt: &str) -> anyhow::Result<String> {
    let pw = Password::new()
        .with_prompt(format!("{prompt} ({MIN_PASSWORD_LEN}+ characters)"))
        .with_confirmation("Confirm password", "Passwords don't match")
        .validate_with(|input: &String| -> Result<(), String> {
            if input.chars().count() < MIN_PASSWORD_LEN {
                Err(format!(
                    "password must be at least {MIN_PASSWORD_LEN} characters"
                ))
            } else {
                Ok(())
            }
        })
        .interact()?;
    Ok(pw)
}
