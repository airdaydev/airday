//! Per-account on-disk state.
//!
//! `device.json` carries the public-ish state (account id, server URL,
//! device id, last_acked_seq). `secrets.json` holds the device token
//! and DEK in cleartext. When keychain-backed storage lands,
//! `secrets.json` becomes a fallback for non-keychain hosts.

use std::path::{Path, PathBuf};

use airday_core::{Doc, DocError};
use serde::{Deserialize, Serialize};
use tokio::sync::OnceCell;
use tokio_rusqlite::Connection;
use uuid::Uuid;

use crate::db;

const ROOT_DIR: &str = "airday";
const DEVICE_FILE: &str = "device.json";
const SECRETS_FILE: &str = "secrets.json";
const DOC_DB_FILE: &str = "loro.db";
const LEGACY_DOC_FILE: &str = "loro.bin";

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("decode: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("doc: {0}")]
    Doc(#[from] DocError),
    #[error("db: {0}")]
    Db(#[from] db::DbError),
    #[error("sqlite: {0}")]
    Sqlite(#[from] tokio_rusqlite::Error),
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

/// Top-level on-disk handle. Path layout:
/// ```text
///   <data>/airday/<account-id-prefix>/device.json
///   <data>/airday/<account-id-prefix>/secrets.json
///   <data>/airday/<account-id-prefix>/loro.db
/// ```
pub struct Profile {
    pub dir: PathBuf,
    conn: OnceCell<Connection>,
}

impl Profile {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            conn: OnceCell::new(),
        }
    }

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
        Ok(Some(Self::new(dir)))
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

    pub async fn write_doc(&self, doc_id: &Uuid, doc: &Doc) -> Result<(), ConfigError> {
        let bytes = doc.save()?;
        let doc_bytes = doc_id.as_bytes().to_vec();
        let conn = self.conn().await?;
        conn.call(move |c| {
            c.execute(
                "INSERT INTO docs (doc_id, payload, updated_at) VALUES (?, ?, ?)
                 ON CONFLICT (doc_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
                rusqlite::params![doc_bytes, bytes, now_millis()],
            )?;
            Ok(())
        })
        .await?;
        Ok(())
    }

    /// Read the persisted doc for `doc_id`. Returns `NotFound` (as `Io`)
    /// when no snapshot row exists yet — matches the previous
    /// file-based `read_doc` shape so call sites that healed `NotFound`
    /// into `Doc::empty()` keep working unchanged.
    pub async fn read_doc(&self, doc_id: &Uuid) -> Result<Doc, ConfigError> {
        let conn = self.conn().await?;
        let doc_bytes = doc_id.as_bytes().to_vec();
        let bytes: Option<Vec<u8>> = conn
            .call(move |c| {
                let result = c.query_row(
                    "SELECT payload FROM docs WHERE doc_id = ?",
                    [doc_bytes],
                    |r| r.get::<_, Vec<u8>>(0),
                );
                match result {
                    Ok(bytes) => Ok(Some(bytes)),
                    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                    Err(e) => Err(e.into()),
                }
            })
            .await?;
        match bytes {
            Some(bytes) => Ok(Doc::load(&bytes)?),
            None => Err(ConfigError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "no doc snapshot",
            ))),
        }
    }

    pub fn doc_path(&self) -> PathBuf {
        self.dir.join(DOC_DB_FILE)
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

    async fn conn(&self) -> Result<&Connection, ConfigError> {
        self.conn
            .get_or_try_init(|| async {
                // Older builds wrote a `loro.bin` blob in this dir.
                // Nuke it on first sqlite open — we're not preserving
                // it; users rehydrate via `airday sync`.
                let legacy = self.dir.join(LEGACY_DOC_FILE);
                if legacy.exists() {
                    let _ = std::fs::remove_file(&legacy);
                }
                let conn = db::open(&self.dir.join(DOC_DB_FILE)).await?;
                Ok(conn)
            })
            .await
    }
}

fn now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
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
    let stripped: String = account_id
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
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
