use std::path::Path;
use std::sync::Arc;

use crate::db::Db;

#[derive(Clone)]
pub struct AppState {
    pub db: Db,
    pub clock: Arc<dyn Clock>,
}

impl AppState {
    pub async fn open(path: &Path) -> anyhow::Result<Self> {
        Ok(Self {
            db: Db::open(path).await?,
            clock: Arc::new(SystemClock),
        })
    }

    pub async fn open_in_memory() -> anyhow::Result<Self> {
        Ok(Self {
            db: Db::open_in_memory().await?,
            clock: Arc::new(SystemClock),
        })
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
