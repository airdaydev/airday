use async_trait::async_trait;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::common::error::AppError;

// Creating a workspace
struct Workspace {}

#[async_trait]
pub trait WorkspaceModel: Send + Sync {
    async fn create(&self, owner_id: &Uuid) -> Result<Option<Workspace>, AppError>;
}

pub struct WorkspaceModelSqlite {
    pool: SqlitePool,
}

impl WorkspaceModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl WorkspaceModel for WorkspaceModelSqlite {
    async fn create(&self, owner_id: &Uuid) -> Result<Option<Workspace>, AppError> {
        Ok(Some(Workspace {}))
    }
}
