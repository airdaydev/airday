use crate::common::error::AppError;
use crate::workspace::model::{Workspace, WorkspaceModel};
use async_trait::async_trait;
use sqlx::types::Uuid as SqlxUuid;
use sqlx::{Executor, SqlitePool};
use uuid::Uuid;

pub struct WorkspaceModelSqlite {
    pub pool: SqlitePool,
}

impl WorkspaceModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
    pub async fn create<'e, E>(ex: E, name: String) -> Result<Workspace, AppError>
    where
        E: Executor<'e, Database = sqlx::Sqlite>,
    {
        let workspace_uuid = Uuid::new_v4();
        let workspace_sqlx_uuid = SqlxUuid::from_bytes(workspace_uuid.into_bytes());
        // Create workspace
        let workspace = sqlx::query_as!(
            Workspace,
            r#"
  INSERT INTO workspace (id, name) VALUES (?, ?) RETURNING id as "id: Uuid", name
  "#,
            workspace_sqlx_uuid,
            name
        )
        .fetch_one(ex)
        .await
        .map_err(|err| AppError::from(err))?;
        Ok(workspace)
    }
}

#[async_trait]
impl WorkspaceModel for WorkspaceModelSqlite {
    async fn create_owned(&self, owner_id: &Uuid) -> Result<Workspace, AppError> {
        let mut tx = self.pool.begin().await.map_err(|err| AppError::from(err))?;

        let name = String::from("Personal");

        let workspace = WorkspaceModelSqlite::create(&mut *tx, name).await?;

        // Create user_workspace relationship
        let owner_sqlx_uuid = SqlxUuid::from_bytes(owner_id.into_bytes());

        sqlx::query!(
            r#"
    INSERT INTO user_workspace (user_id, workspace_id) VALUES (?, ?)
    "#,
            owner_sqlx_uuid,
            workspace.id,
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
            workspace.id,
            owner_sqlx_uuid,
        )
        .execute(&mut *tx)
        .await
        .map_err(|err| AppError::from(err))?;

        tx.commit().await.map_err(|err| AppError::from(err))?;

        Ok(workspace)
    }
}
