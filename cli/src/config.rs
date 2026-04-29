//! Per-account on-disk state.
//!
//! `device.json` carries the public-ish state (account id, server URL,
//! device id, last_acked_op_id). `secrets.json` holds the device token
//! and DEK in cleartext. The keychain story is sprint-1 deferred — when
//! it lands, `secrets.json` becomes a fallback for non-keychain hosts.

use std::path::{Path, PathBuf};

use airday_core::{Doc, DocError};
use serde::{Deserialize, Serialize};

const ROOT_DIR: &str = "airday";
const DEVICE_FILE: &str = "device.json";
const SECRETS_FILE: &str = "secrets.json";
const DOC_FILE: &str = "loro.bin";

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("decode: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("doc: {0}")]
    Doc(#[from] DocError),
    #[error("no XDG data directory available")]
    NoDataDir,
    #[error("not logged in")]
    NotLoggedIn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfig {
    pub account_id: String,
    pub email: String,
    pub server_url: String,
    pub device_id: String,
    /// Sync engine's frontier; bumped after every applied op. 0 until
    /// the sync layer ships.
    #[serde(default)]
    pub last_acked_op_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Secrets {
    pub device_token: String,
    /// Hex-encoded DEK. Plain-file storage is the sprint-1 stopgap; see
    /// module docs.
    pub dek_hex: String,
}

/// Top-level on-disk handle. Path layout:
/// ```text
///   <data>/airday/<account-id-prefix>/device.json
///   <data>/airday/<account-id-prefix>/secrets.json
/// ```
pub struct Profile {
    pub dir: PathBuf,
}

impl Profile {
    /// Path to the active profile, if one is logged in. Active = the
    /// one symlink at `<data>/airday/active` resolves to.
    pub fn active() -> Result<Option<Self>, ConfigError> {
        let root = root_dir()?;
        let active = root.join("active");
        if !active.exists() {
            return Ok(None);
        }
        let target = std::fs::read_link(&active)?;
        let dir = if target.is_absolute() {
            target
        } else {
            root.join(target)
        };
        if !dir.join(DEVICE_FILE).exists() {
            return Ok(None);
        }
        Ok(Some(Self { dir }))
    }

    pub fn require_active() -> Result<Self, ConfigError> {
        Self::active()?.ok_or(ConfigError::NotLoggedIn)
    }

    /// Open or create the profile directory for an account id, then
    /// point `active` at it.
    pub fn create(account_id: &str) -> Result<Self, ConfigError> {
        let root = root_dir()?;
        std::fs::create_dir_all(&root)?;
        let prefix = account_id_prefix(account_id);
        let dir = root.join(prefix);
        std::fs::create_dir_all(&dir)?;
        // Repoint the `active` symlink to this profile.
        let active = root.join("active");
        let _ = std::fs::remove_file(&active);
        symlink(&dir, &active)?;
        Ok(Self { dir })
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

    pub fn write_doc(&self, doc: &Doc) -> Result<(), ConfigError> {
        let bytes = doc.save()?;
        write_bytes(&self.dir.join(DOC_FILE), &bytes, 0o600)
    }

    pub fn read_doc(&self) -> Result<Doc, ConfigError> {
        let bytes = std::fs::read(self.dir.join(DOC_FILE))?;
        Ok(Doc::load(&bytes)?)
    }

    pub fn doc_path(&self) -> PathBuf {
        self.dir.join(DOC_FILE)
    }

    /// Wipe local state. Used by `airday logout`.
    pub fn purge(&self) -> Result<(), ConfigError> {
        if self.dir.exists() {
            std::fs::remove_dir_all(&self.dir)?;
        }
        let active = root_dir()?.join("active");
        let _ = std::fs::remove_file(active);
        Ok(())
    }
}

fn root_dir() -> Result<PathBuf, ConfigError> {
    // `AIRDAY_DATA_DIR` lets tests (and adventurous users) override the
    // platform-default data dir without rebuilding. Production paths
    // never set it.
    if let Ok(v) = std::env::var("AIRDAY_DATA_DIR") {
        if !v.is_empty() {
            return Ok(PathBuf::from(v).join(ROOT_DIR));
        }
    }
    let base = dirs::data_local_dir().ok_or(ConfigError::NoDataDir)?;
    Ok(base.join(ROOT_DIR))
}

fn account_id_prefix(account_id: &str) -> String {
    // First 8 hex chars of the uuid (without dashes) is enough for
    // local disambiguation between accounts on the same machine.
    let stripped: String = account_id.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    stripped.chars().take(8).collect()
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

fn write_bytes(path: &Path, bytes: &[u8], _mode: u32) -> Result<(), ConfigError> {
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

#[cfg(unix)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(windows)]
fn symlink(target: &Path, link: &Path) -> std::io::Result<()> {
    if target.is_dir() {
        std::os::windows::fs::symlink_dir(target, link)
    } else {
        std::os::windows::fs::symlink_file(target, link)
    }
}
