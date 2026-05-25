use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::db::Db;
use crate::sync::{SnapshotCoordinator, SyncSessions};

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub clock: Arc<dyn Clock>,
    pub sync_sessions: SyncSessions,
    pub snapshot_coordinator: SnapshotCoordinator,
    /// Mirror of `Config::secure_cookies`. Lives on state because the
    /// cookie helpers run from request handlers, not at startup.
    pub secure_cookies: bool,
}

impl AppState {
    pub async fn open(path: &Path) -> anyhow::Result<Self> {
        Ok(Self {
            db: Db::open(path).await?,
            clock: Arc::new(SystemClock),
            sync_sessions: SyncSessions::new(),
            snapshot_coordinator: SnapshotCoordinator::new(),
            secure_cookies: true,
        })
    }

    pub async fn open_in_memory() -> anyhow::Result<Self> {
        Ok(Self {
            db: Db::open_in_memory().await?,
            clock: Arc::new(SystemClock),
            sync_sessions: SyncSessions::new(),
            snapshot_coordinator: SnapshotCoordinator::new(),
            secure_cookies: true,
        })
    }

    pub fn with_secure_cookies(mut self, secure: bool) -> Self {
        self.secure_cookies = secure;
        self
    }

    pub fn with_snapshot_threshold_ops(mut self, threshold_ops: u64) -> Self {
        self.snapshot_coordinator = SnapshotCoordinator::with_threshold_ops(threshold_ops);
        self
    }
}

/// Indirection so tests can fast-forward time without sleeping (used
/// for recovery-session expiry today, will see more use as features
/// land).
pub trait Clock: Send + Sync + std::fmt::Debug + 'static {
    fn now_millis(&self) -> i64;
}

#[derive(Debug)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_millis(&self) -> i64 {
        crate::db::now_millis()
    }
}
