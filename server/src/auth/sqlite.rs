use async_trait::async_trait;
use sqlx::{Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{
    auth::{
        meta::ClientMeta,
        session::{
            AuthToken, AuthTokenKind, HashedAuthToken, InsertSessionParams, SessionModel,
            UserSession,
        },
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

async fn upsert_token<'a>(
    mut tx: Transaction<'a, Sqlite>,
    token: &'a AuthToken,
) -> Result<Transaction<'a, Sqlite>, AppError> {
    let hash = token.hash_token()?;
    let is_refresh = token.kind == crate::auth::session::AuthTokenKind::Refresh;

    sqlx::query!(
        r#"
        INSERT INTO session_token (session_id, hash, expires, kind)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id, kind) DO UPDATE SET
            hash = excluded.hash,
            expires = excluded.expires,
            refresh = excluded.kind
        "#,
        token.session_id,
        hash,
        token.exp,
        is_refresh
    )
    .execute(tx.as_mut())
    .await?;

    Ok(tx)
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
