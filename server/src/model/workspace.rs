use async_trait::async_trait;
use sqlx::SqlitePool;
use sqlx::types::Uuid as SqlxUuid;
use uuid::Uuid;

use crate::common::error::AppError;

// Creating a workspace
struct Workspace {
    id: Uuid,
    name: String,
}

#[async_trait]
pub trait WorkspaceModel: Send + Sync {
    async fn create(&self, owner_id: &Uuid) -> Result<Workspace, AppError>;
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
    async fn create(&self, owner_id: &Uuid) -> Result<Workspace, AppError> {
        let uuid = Uuid::new_v4();
        let sqlx_uuid = SqlxUuid::from_bytes(uuid.into_bytes());
        let name = String::from("Personal");
        let result = sqlx::query_as!(
            Workspace,
            r#"
    INSERT INTO workspace (id, name) VALUES (?, ?) RETURNING id as "id: Uuid", name
    "#,
            sqlx_uuid,
            name
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|err| Err(AppError::DatabaseError(err.to_string())))?;
        Ok(result)
    }
}
