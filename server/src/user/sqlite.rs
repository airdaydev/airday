use crate::{
    common::error::AppError,
    library::{model::Library, sqlite::LibraryModelSqlite},
    user::model::{User, UserModel, hash_password},
};
use async_trait::async_trait;
use sqlx::{SqlitePool, types::Uuid as SqlxUuid};
use uuid::Uuid;

pub struct UserModelSqlite {
    pool: SqlitePool,
}

#[async_trait]
impl UserModel for UserModelSqlite {
    async fn get_by_email(&self, email: &str) -> Result<Option<User>, AppError> {
        let result = sqlx::query!(
            r#"
            SELECT user.id as "id: Uuid", email, password_hash,
            library.id as "library_id: Option<Uuid>", library.name as "library_name: Option<String>"
            FROM user
            LEFT JOIN library ON library.id = primary_library_id
            WHERE email = ?
            "#,
            email
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = result {
            let user = self.build_user_with_library(
                row.id,
                row.email,
                row.password_hash,
                row.library_id,
                row.library_name,
            );
            return Ok(Some(user));
        }
        Ok(None)
    }
    async fn get_by_id(&self, id: &Uuid) -> Result<Option<User>, AppError> {
        let sqlx_uuid = SqlxUuid::from_bytes(id.into_bytes());
        let result = sqlx::query!(
            r#"
            SELECT user.id as "id: Uuid", email, password_hash,
            library.id as "library_id: Option<Uuid>", library.name as "library_name: Option<String>"
            FROM user
            JOIN library ON library.id = primary_library_id
            WHERE user.id = ?
            "#,
            sqlx_uuid
        )
        .fetch_optional(&self.pool)
        .await?;

        // nesting with sqlx is difficult, this is simpler
        if let Some(row) = result {
            let user = self.build_user_with_library(
                row.id,
                row.email,
                row.password_hash,
                row.library_id,
                row.library_name,
            );
            return Ok(Some(user));
        }
        Ok(None)
    }
    async fn create(&self, email: &str, password: &str) -> Result<User, AppError> {
        // 1. Create primary library
        let mut tx = self.pool.begin().await?;
        let name = String::from("Private");
        let primary_library = LibraryModelSqlite::create_with(&mut *tx, name).await?;
        // 2. Create associated user
        let password_hash = hash_password(password)?;
        let uuid = Uuid::new_v4();
        let sqlx_uuid = SqlxUuid::from_bytes(uuid.into_bytes());
        let result = sqlx::query!(
            r#"
      INSERT INTO user (id, email, password_hash, primary_library_id) VALUES (?, ?, ?, ?)
      RETURNING id as "id: Uuid", email, password_hash
      "#,
            sqlx_uuid,
            email,
            password_hash,
            primary_library.id
        )
        .fetch_one(&mut *tx)
        .await;
        match result {
            Ok(row) => {
                let user = User {
                    id: row.id,
                    email: row.email,
                    password_hash: row.password_hash,
                    primary_library: Some(Library {
                        id: primary_library.id,
                        name: primary_library.name,
                        seq: None,
                    }),
                };
                tx.commit().await?;
                Ok(user)
            }
            Err(sqlx::Error::Database(db_err)) => {
                if db_err.is_unique_violation() {
                    Err(AppError::ValidationError(String::from(
                        "A user with this email already exists.",
                    )))
                } else {
                    Err(AppError::DatabaseError(db_err.to_string()))
                }
            }
            Err(e) => Err(AppError::from(e)),
        }
    }

    // async fn update_user(
    //     &self,
    //     user_id: &Uuid,
    //     attributes: UserAttributes,
    // ) -> Result<(), AppError> {
    //     let sqlx_user_id = SqlxUuid::from_bytes(user_id.into_bytes());

    //     // Only update primary_library if it was provided in the request
    //     if let Some(library_update) = attributes.primary_library_id {
    //         let library_value: Option<SqlxUuid> = match library_update {
    //             LibraryUpdate::Set(library_id) => {
    //                 Some(SqlxUuid::from_bytes(library_id.into_bytes()))
    //             }
    //             LibraryUpdate::Unset => None,
    //         };
    //         sqlx::query!(
    //             "UPDATE user SET primary_library_id = ? WHERE id = ?",
    //             library_value,
    //             sqlx_user_id
    //         )
    //         .execute(&self.pool)
    //         .await?;
    //     }
    //     Ok(())
    // }
}

impl UserModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    fn build_user_with_library(
        &self,
        id: Uuid,
        email: String,
        password_hash: String,
        library_id: Option<Uuid>,
        library_name: Option<String>,
    ) -> User {
        let library = library_id.map(|id| Library {
            id,
            name: library_name.unwrap_or_default(),
            seq: None,
        });

        User {
            id,
            email,
            password_hash,
            primary_library: library,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{test_util, user::model::verify_password};

    #[tokio::test]
    async fn test_create_user() {
        let db = test_util::create_test_db().await;
        let email = "daniel@air.day";
        let password = "abcd12375kajsflaks";
        let user = db.user.create(email, password).await.unwrap();
        assert_eq!(user.email, email);
        assert!(!user.password_hash.is_empty());
        assert_ne!(user.password_hash, password);
        assert!(user.password_hash.starts_with("$argon2"));
    }

    #[tokio::test]
    async fn test_verify_password() {
        let db = test_util::create_test_db().await;
        let email = "pw_test@air.day";
        let password = "abcd12375kajsflaks";
        let user = db.user.create(email, password).await.unwrap();
        verify_password(&user.password_hash, password).unwrap();
        assert!(verify_password(&user.password_hash, "wrongpassword").is_err())
    }

    #[tokio::test]
    async fn test_get_user_by_id() {
        let db = test_util::create_test_db().await;
        let email = "id_test@air.day";
        let password = "abcd12375kajsflaks";
        let user = db.user.create(email, password).await.unwrap();

        let user_id = Uuid::from_bytes(user.id.into_bytes());
        let found_user = db.user.get_by_id(&user_id).await.unwrap();

        assert!(found_user.is_some());
        let found_user = found_user.unwrap();
        assert_eq!(found_user.id, user.id);
        assert_eq!(found_user.email, email);

        // Test with non-existent ID
        let non_existent_id = Uuid::new_v4();
        let not_found = db.user.get_by_id(&non_existent_id).await.unwrap();
        assert!(not_found.is_none());
    }

    // TODO: Reinstate if we need to update a user property
    // #[tokio::test]
    // async fn test_update_user_attributes() {
    //     // TODO: Review
    //     let db = test_util::create_test_db().await;
    //     let user = test_util::mock_user(&db, String::from("user_attr_updates@air.day")).await;
    //     let library = db.library._create(&user.id).await.unwrap();
    //     let library_2 = db.library._create(&user.id).await.unwrap();
    //     let current_user_state = db.user.get_by_id(&user.id).await.unwrap().unwrap();
    //     assert_eq!(current_user_state.primary_library.unwrap().id, library.id);
    //     db.user
    //         .update_user(
    //             &user.id,
    //             UserAttributes {
    //                 primary_library_id: Some(LibraryUpdate::Set(library_2.id)),
    //             },
    //         )
    //         .await
    //         .unwrap();
    //     let post_user_state = db.user.get_by_id(&user.id).await.unwrap().unwrap();
    //     assert_eq!(post_user_state.primary_library.unwrap().id, library_2.id);
    // }
}
