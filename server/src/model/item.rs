use std::pin::Pin;

use crate::common::error::AppError;
use async_trait::async_trait;
use futures_util::{Stream, StreamExt, TryStreamExt};
use sqlx::{Error, SqlitePool, error::DatabaseError, sqlite::SqliteRow};
use uuid::Uuid;

struct SqlItem {
    id: Uuid,
    pub text: String,
}

struct LWWStringRegister {}

// TODO: Implement Item from SqlItem
// TODO: Define LWWStringRegister
struct Item {
    pub id: Uuid,
    pub text: Option<String>,
}

impl From<SqlItem> for Item {
    fn from(sql_item: SqlItem) -> Self {
        Self {
            id: sql_item.id,
            text: sql_item.text,
        }
    }
}

#[async_trait]
pub trait UserModel: Send + Sync {
    // Accept query options
    async fn get_by_workspace(
        &self,
        // workspace: &Uuid,
    ) -> Pin<Box<dyn Stream<Item = Result<SqliteRow, AppError>> + Send>>;
    async fn merge(&self, _: String) -> Result<Item, AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}

pub struct ItemModelSqlite {
    pool: SqlitePool,
}

#[async_trait]
impl UserModel for ItemModelSqlite {
    async fn merge(&self, _: String) -> Result<SqlItem, AppError> {
        let update = sqlx::query!(
            r#"INSERT INTO items (id, age)
          VALUES('steven', 32)
          ON CONFLICT(user_name)
          DO UPDATE SET age=excluded.age;"#
        );
    }
    async fn get_by_workspace(
        &self,
        // workspace: &Uuid,
    ) -> Pin<Box<dyn Stream<Item = Result<SqliteRow, AppError>> + Send>> {
        let stream = sqlx::query_as!(Item, r#""#).fetch(&self.pool);
        let mapped_stream =
            stream.map(|result| result.map_err(|e| AppError::DatabaseError(e.to_string())));
        Box::pin(mapped_stream)
    }
}
