use async_trait::async_trait;
use serde::Serialize;
use sqlx::SqlitePool;
use sqlx::types::Uuid as SqlxUuid;
use uuid::Uuid;

use crate::common::error::AppError;

// Creating a workspace
#[derive(Serialize)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
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
        let mut tx = self.pool.begin().await.map_err(|err| AppError::from(err))?;

        let workspace_uuid = Uuid::new_v4();
        let workspace_sqlx_uuid = SqlxUuid::from_bytes(workspace_uuid.into_bytes());
        let name = String::from("Personal");

        // Create workspace
        let workspace = sqlx::query_as!(
            Workspace,
            r#"
    INSERT INTO workspace (id, name) VALUES (?, ?) RETURNING id as "id: Uuid", name
    "#,
            workspace_sqlx_uuid,
            name
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|err| AppError::from(err))?;

        // Create user_workspace relationship
        let owner_sqlx_uuid = SqlxUuid::from_bytes(owner_id.into_bytes());

        sqlx::query!(
            r#"
    INSERT INTO user_workspace (user_id, workspace_id) VALUES (?, ?)
    "#,
            owner_sqlx_uuid,
            workspace_sqlx_uuid
        )
        .execute(&mut *tx)
        .await
        .map_err(|err| AppError::from(err))?;

        sqlx::query!(
            r#"
            UPDATE user
            SET default_workspace_id = ?
            WHERE id = ?
              AND default_workspace_id IS NULL;
    "#,
            workspace_sqlx_uuid,
            owner_sqlx_uuid,
        )
        .execute(&mut *tx)
        .await
        .map_err(|err| AppError::from(err))?;

        tx.commit().await.map_err(|err| AppError::from(err))?;

        Ok(workspace)
    }
}
