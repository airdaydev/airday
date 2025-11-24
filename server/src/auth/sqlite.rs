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
        tx = upsert_token(tx, &params.session_token).await?;
        tx = upsert_token(tx, &params.refresh_token).await?;
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
    async fn get_token(
        &self,
        session_id: Uuid,
        kind: AuthTokenKind,
    ) -> Result<Option<HashedAuthToken>, AppError> {
        let sql_kind = match kind {
            AuthTokenKind::Refresh => "REFRESH",
            AuthTokenKind::Session => "SESSION",
        };
        let result = sqlx::query!(
            r#"
            SELECT session_id as "session_id: Uuid",
            hash as "hash: Vec<u8>",
            expires, kind
            FROM session_token
            WHERE session_id = ? AND kind = ?
            "#,
            session_id,
            sql_kind,
        )
        .fetch_optional(&self.pool)
        .await?;

        match result {
            Some(row) => Ok(Some(HashedAuthToken {
                session_id: row.session_id,
                hash: row.hash,
                exp: row.expires,
                kind: crate::auth::session::AuthTokenKind::Refresh,
            })),
            None => Ok(None),
        }
    }
    async fn update_tokens(
        &self,
        session_token: &AuthToken,
        refresh_token: &AuthToken,
    ) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await?;
        tx = upsert_token(tx, session_token).await?;
        tx = upsert_token(tx, refresh_token).await?;
        tx.commit().await;
        Ok(())
    }
}
