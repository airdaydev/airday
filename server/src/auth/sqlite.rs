use async_trait::async_trait;
use chrono::{DateTime, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{
    auth::session::{
        InsertSessionParams, SessionModel, TokenPair, UserSession, get_current_timestamp,
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
        sqlx::query!(
          r#"
          INSERT INTO session (id, token, expires, refresh_token, refresh_expires, user_id, user_agent, ip)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          "#,
          params.id,
          params.token,
          params.expires,
          params.refresh_token_hash,
          params.refresh_expires,
          params.sqlx_user_id,
          params.client_meta.user_agent,
          params.client_meta.ip
      )
      .execute(&self.pool)
      .await?;
        Ok(())
    }
    // Used to enumerate sessions on client, for security, remotely destroying sessions etc
    async fn get_by_user(&self, user_id: Uuid) -> Result<Vec<UserSession>, AppError> {
        let now = get_current_timestamp();
        let results = sqlx::query!(
            r#"
        SELECT id as "id: Uuid", token, expires as "expires: DateTime<Utc>",
        refresh_token, refresh_expires as "refresh_expires: DateTime<Utc>", user_id as 'user_id: Uuid'
        FROM session
        WHERE user_id = ? AND expires > ?
        "#,
            user_id,
            now
        )
        .fetch_all(&self.pool)
        .await?;

        let sessions: Vec<UserSession> = results
            .into_iter()
            .map(|row| UserSession {
                id: row.id,
                user_id: row.user_id,
            })
            .collect();
        Ok(sessions)
    }
    async fn get_by_id(&self, id: Uuid) -> Result<Option<TokenPair>, AppError> {
        let now = get_current_timestamp();

        let result = sqlx::query!(
            r#"
            SELECT id as "id: Uuid", token, expires as "expires: DateTime<Utc>",
            refresh_token, refresh_expires as "refresh_expires: DateTime<Utc>", user_id as 'user_id: Uuid'
            FROM session
            WHERE id = ? AND refresh_expires > ?
            "#,
            id,
            now
        )
        .fetch_optional(&self.pool)
        .await?;

        match result {
            Some(row) => Ok(Some(TokenPair {
                id: row.id,
                token: row.token,
                expires: row.expires,
                refresh_token: row.refresh_token,
                refresh_expires: row.refresh_expires,
                user_id: row.user_id,
            })),
            None => Ok(None),
        }
    }
    async fn update_token(
        &self,
        session_id: Uuid,
        token_refresh: &TokenRefresh,
    ) -> Result<(), AppError> {
        sqlx::query!(
            r#"
          UPDATE session
          SET token = ?, expires = ?, refresh_token = ?, refresh_expires = ?
          WHERE id = ?
          "#,
            token_refresh.token,
            token_refresh.expires,
            token_refresh.refresh_token_hash,
            token_refresh.refresh_expires,
            session_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    async fn get_by_token(&self, token: &str) -> Result<Option<TokenPair>, AppError> {
        let now = get_current_timestamp();

        let result = sqlx::query!(
            r#"
            SELECT id as "id: Uuid", token, expires as "expires: DateTime<Utc>",
            refresh_token, refresh_expires as "refresh_expires: DateTime<Utc>",
            user_id as 'user_id: Uuid'
            FROM session
            WHERE token = ? AND expires > ?
            "#,
            token,
            now
        )
        .fetch_optional(&self.pool)
        .await?;

        match result {
            Some(row) => Ok(Some(TokenPair {
                id: row.id,
                expires: row.expires,
                token: row.id.to_string(),
                refresh_token: row.refresh_token,
                refresh_expires: row.refresh_expires,
                user_id: row.user_id,
            })),
            None => Ok(None),
        }
    }
}
