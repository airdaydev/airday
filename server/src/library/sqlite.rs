use crate::common::error::AppError;
use crate::library::model::{Library, LibraryModel};
use async_trait::async_trait;
use sqlx::types::Uuid as SqlxUuid;
use sqlx::{Executor, SqlitePool};
use uuid::Uuid;

pub struct LibraryModelSqlite {
    pub pool: SqlitePool,
}

impl LibraryModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
    pub async fn create_with<'e, E>(ex: E, name: String) -> Result<Library, AppError>
    where
        E: Executor<'e, Database = sqlx::Sqlite>,
    {
        let library_uuid = Uuid::new_v4();
        let library_sqlx_uuid = SqlxUuid::from_bytes(library_uuid.into_bytes());
        // Create library
        let library = sqlx::query_as!(
            Library,
            r#"
  INSERT INTO library (id, name) VALUES (?, ?) RETURNING id as "id: Uuid", name
  "#,
            library_sqlx_uuid,
            name
        )
        .fetch_one(ex)
        .await?;
        Ok(library)
    }
}

#[async_trait]
impl LibraryModel for LibraryModelSqlite {
    async fn _create(&self, owner_id: &Uuid) -> Result<Library, AppError> {
        let mut tx = self.pool.begin().await?;

        let name = String::from("Personal");

        let library = LibraryModelSqlite::create_with(&mut *tx, name).await?;

        // Create user_library relationship
        let owner_sqlx_uuid = SqlxUuid::from_bytes(owner_id.into_bytes());

        sqlx::query!(
            r#"
    INSERT INTO user_library (user_id, library_id) VALUES (?, ?)
    "#,
            owner_sqlx_uuid,
            library.id,
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(library)
    }
}
