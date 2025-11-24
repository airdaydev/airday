use async_trait::async_trait;
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{
    auth::{
        meta::ClientMeta,
        session::{InsertSessionParams, SessionModel, UserSession},
    },
    common::error::AppError,
};

pub struct SessionModelSqlite {
    pool: SqlitePool,
}

impl SessionModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl SessionModel for SessionModelSqlite {
    async fn insert_session(&self, params: InsertSessionParams) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!(
            r#"
          INSERT INTO session (id, user_id, user_agent, ip)
          VALUES (?, ?, ?, ?)
          "#,
            params.id,
            params.user_id,
            params.client_meta.user_agent,
            params.client_meta.ip
        )
        .execute(tx.as_mut())
        .await?;
        tx.commit().await?;
        Ok(())
    }
    // Used to enumerate sessions on client, for security, remotely destroying sessions etc
    async fn get_by_user(&self, user_id: Uuid) -> Result<Vec<UserSession>, AppError> {
        let results = sqlx::query!(
            r#"
        SELECT id as "id: Uuid", user_id as 'user_id: Uuid', ip, user_agent
        FROM session
        WHERE user_id = ?
        "#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;

        let sessions: Vec<UserSession> = results
            .into_iter()
            .map(|row| UserSession {
                id: row.id,
                user_id: row.user_id,
                client_meta: ClientMeta {
                    user_agent: row.user_agent,
                    ip: row.ip,
                },
            })
            .collect();
        Ok(sessions)
    }
}
