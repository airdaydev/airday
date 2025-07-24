use crate::{
    common::error::AppError,
    user::model::{User, UserAttributes, UserModel, WorkspaceUpdate, hash_password},
    workspace::{model::Workspace, sqlite::WorkspaceModelSqlite},
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
            workspace.id as "workspace_id: Option<Uuid>", workspace.name as "workspace_name: Option<String>"
            FROM user
            LEFT JOIN workspace ON workspace.id = primary_workspace_id
            WHERE email = ?
            "#,
            email
        )
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = result {
            let user = self.build_user_with_workspace(
                row.id,
                row.email,
                row.password_hash,
                row.workspace_id,
                row.workspace_name,
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
            workspace.id as "workspace_id: Option<Uuid>", workspace.name as "workspace_name: Option<String>"
            FROM user
            JOIN workspace ON workspace.id = primary_workspace_id
            WHERE user.id = ?
            "#,
            sqlx_uuid
        )
        .fetch_optional(&self.pool)
        .await?;

        // nesting with sqlx is difficult, this is simpler
        if let Some(row) = result {
            let user = self.build_user_with_workspace(
                row.id,
                row.email,
                row.password_hash,
                row.workspace_id,
                row.workspace_name,
            );
            return Ok(Some(user));
        }
        Ok(None)
    }
    async fn create(&self, email: &str, password: &str) -> Result<User, AppError> {
        // 1. Create primary workspace
        let mut tx = self.pool.begin().await?;
        let name = String::from("Private");
        let primary_workspace = WorkspaceModelSqlite::create_with(&mut *tx, name).await?;
        // 2. Create associated user
        let password_hash = hash_password(password)?;
        let uuid = Uuid::new_v4();
        let sqlx_uuid = SqlxUuid::from_bytes(uuid.into_bytes());
        let result = sqlx::query!(
            r#"
      INSERT INTO user (id, email, password_hash, primary_workspace_id) VALUES (?, ?, ?, ?)
      RETURNING id as "id: Uuid", email, password_hash
      "#,
            sqlx_uuid,
            email,
            password_hash,
            primary_workspace.id
        )
        .fetch_one(&mut *tx)
        .await;
        match result {
            Ok(row) => {
                let user = User {
                    id: row.id,
                    email: row.email,
                    password_hash: row.password_hash,
                    primary_workspace: Some(Workspace {
                        id: primary_workspace.id,
                        name: primary_workspace.name,
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

    async fn update_user(
        &self,
        user_id: &Uuid,
        attributes: UserAttributes,
    ) -> Result<(), AppError> {
        let sqlx_user_id = SqlxUuid::from_bytes(user_id.into_bytes());

        // Only update primary_workspace if it was provided in the request
        if let Some(workspace_update) = attributes.primary_workspace_id {
            let workspace_value: Option<SqlxUuid> = match workspace_update {
                WorkspaceUpdate::Set(workspace_id) => {
                    Some(SqlxUuid::from_bytes(workspace_id.into_bytes()))
                }
                WorkspaceUpdate::Unset => None,
            };
            sqlx::query!(
                "UPDATE user SET primary_workspace_id = ? WHERE id = ?",
                workspace_value,
                sqlx_user_id
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }
}

impl UserModelSqlite {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    fn build_user_with_workspace(
        &self,
        id: Uuid,
        email: String,
        password_hash: String,
        workspace_id: Option<Uuid>,
        workspace_name: Option<String>,
    ) -> User {
        let workspace = workspace_id.map(|id| Workspace {
            id,
            name: workspace_name.unwrap_or_default(),
        });

        User {
            id,
            email,
            password_hash,
            primary_workspace: workspace,
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

    // TODO: Update user test
    #[tokio::test]
    async fn test_update_user_attributes() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("user_attr_updates@air.day")).await;
        let workspace = db.workspaces.create(&user.id).await.unwrap();
        let workspace_2 = db.workspaces.create(&user.id).await.unwrap();
        let current_user_state = db.user.get_by_id(&user.id).await.unwrap().unwrap();
        assert_eq!(
            current_user_state.primary_workspace.unwrap().id,
            workspace.id
        );
        db.user
            .update_user(
                &user.id,
                UserAttributes {
                    primary_workspace_id: Some(WorkspaceUpdate::Set(workspace_2.id)),
                },
            )
            .await
            .unwrap();
        let post_user_state = db.user.get_by_id(&user.id).await.unwrap().unwrap();
        assert_eq!(
            post_user_state.primary_workspace.unwrap().id,
            workspace_2.id
        );
    }
}
