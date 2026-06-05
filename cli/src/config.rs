//! Per-account on-disk state.
//!
//! `device.json` carries the public-ish state (account id, server URL,
//! device id, last_acked_seq). `secrets.json` holds the device token
//! and DEK in cleartext. When keychain-backed storage lands,
//! `secrets.json` becomes a fallback for non-keychain hosts.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const ROOT_DIR: &str = "airday";
const DEVICE_FILE: &str = "device.json";
const SECRETS_FILE: &str = "secrets.json";
const DOC_DB_FILE: &str = "loro.sqlite";

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("decode: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("no XDG data directory available")]
    NoDataDir,
    #[error("not logged in")]
    NotLoggedIn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfig {
    pub account_id: String,
    /// The account's primary (Home) doc id — uuid string. Server-generated
    /// at signup, returned in signup/login/password-reset responses, and
    /// persisted here so local storage can key snapshots on the real
    /// doc id instead of a hardcoded placeholder.
    pub primary_doc_id: String,
    pub email: String,
    pub server_url: String,
    pub device_id: String,
    /// Sync engine's contiguous-prefix frontier; bumped after every
    /// applied op.
    #[serde(default)]
    pub last_acked_seq: u64,
    /// Unix millis of the last successful online flush. `None` means
    /// no online flush has ever completed for this device.
    #[serde(default)]
    pub last_sync_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Secrets {
    pub device_token: String,
    /// Hex-encoded DEK. Plain-file storage is the current stopgap; see
    /// module docs.
    pub dek_hex: String,
}

/// Top-level on-disk handle. Path layout under the root dir (system
/// default `<data>/airday/`, or `AIRDAY_DATA_DIR` if set):
/// ```text
///   <root>/device.json
///   <root>/secrets.json
///   <root>/loro.sqlite
/// ```
pub struct Profile {
    pub dir: PathBuf,
}

impl Profile {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// The single per-install profile, if one is logged in. Airday is
    /// single-human-user (see product thesis); one account at a time,
    /// no profile switching, so "active" collapses to "does the
    /// device file exist?". Run two accounts side-by-side in dev by
    /// pointing `AIRDAY_DATA_DIR` at distinct roots.
    pub fn active() -> Result<Option<Self>, ConfigError> {
        let dir = root_dir()?;
        if !dir.join(DEVICE_FILE).exists() {
            return Ok(None);
        }
        Ok(Some(Self::new(dir)))
    }

    pub fn require_active() -> Result<Self, ConfigError> {
        Self::active()?.ok_or(ConfigError::NotLoggedIn)
    }

    /// Create (or reuse) the single per-install profile directory.
    pub fn create() -> Result<Self, ConfigError> {
        let dir = root_dir()?;
        std::fs::create_dir_all(&dir)?;
        Ok(Self::new(dir))
    }

    pub fn write_device(&self, cfg: &DeviceConfig) -> Result<(), ConfigError> {
        write_json(&self.dir.join(DEVICE_FILE), cfg, 0o600)
    }

    pub fn read_device(&self) -> Result<DeviceConfig, ConfigError> {
        read_json(&self.dir.join(DEVICE_FILE))
    }

    pub fn write_secrets(&self, secrets: &Secrets) -> Result<(), ConfigError> {
        write_json(&self.dir.join(SECRETS_FILE), secrets, 0o600)
    }

    pub fn read_secrets(&self) -> Result<Secrets, ConfigError> {
        read_json(&self.dir.join(SECRETS_FILE))
    }

    /// Path to the per-profile sqlite file. The doc itself is persisted
    /// through `crate::storage::SqliteStorage` (opened against this
    /// path); `Profile` only owns the JSON device/secrets files and the
    /// directory layout.
    pub fn doc_path(&self) -> PathBuf {
        self.dir.join(DOC_DB_FILE)
    }

    /// Wipe local state. Used by `airday logout`.
    pub fn purge(&self) -> Result<(), ConfigError> {
        if self.dir.exists() {
            std::fs::remove_dir_all(&self.dir)?;
        }
        Ok(())
    }
}

fn root_dir() -> Result<PathBuf, ConfigError> {
    // `AIRDAY_DATA_DIR` lets tests (and adventurous users) override the
    // platform-default data dir without rebuilding. Taken verbatim:
    // the user picked the path, so we don't append `airday/` to it.
    // Production paths leave the env var unset, falling through to the
    // namespaced default below — `data_local_dir` is always absolute.
    let raw = match std::env::var("AIRDAY_DATA_DIR") {
        Ok(v) if !v.is_empty() => PathBuf::from(v),
        _ => dirs::data_local_dir()
            .ok_or(ConfigError::NoDataDir)?
            .join(ROOT_DIR),
    };
    // Resolve relative paths against CWD at first read so downstream
    // calls don't silently look in the wrong place if the user `cd`s
    // mid-session. `std::path::absolute` doesn't require the path to
    // exist (unlike `canonicalize`), which matches first-run UX.
    if raw.is_absolute() {
        Ok(raw)
    } else {
        Ok(std::path::absolute(&raw)?)
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T, _mode: u32) -> Result<(), ConfigError> {
    let bytes = serde_json::to_vec_pretty(value)?;
    std::fs::write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = std::fs::metadata(path)?.permissions();
        perm.set_mode(_mode);
        std::fs::set_permissions(path, perm)?;
    }
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, ConfigError> {
    let bytes = std::fs::read(path)?;
    Ok(serde_json::from_slice(&bytes)?)
}
