use crate::AppState;
use crate::auth::meta::ClientMeta;
use crate::auth::token::AuthToken;
use crate::common::error::AppError;
use crate::common::sql::Db;
use crate::user::model::User;
use async_trait::async_trait;
use axum::Json;
use axum::extract::State;
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid as SqlxUuid;
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub struct UserSession {
    pub id: Uuid,
    pub user_id: Uuid,
    pub primary_library: Uuid,
    pub client_meta: ClientMeta,
}

pub struct InsertSessionParams {
    pub id: Uuid,
    pub user_id: SqlxUuid,
    pub client_meta: ClientMeta,
}

#[async_trait]
pub trait SessionModel: Send + Sync {
    async fn insert_session(&self, params: InsertSessionParams) -> Result<(), AppError>;
    async fn get_by_user(&self, user_id: Uuid) -> Result<Vec<UserSession>, AppError>;
    async fn get_by_id(&self, session_id: Uuid) -> Result<Option<UserSession>, AppError>;
}

impl UserSession {
    pub async fn new(db: &Db, user: User, client_meta: ClientMeta) -> Result<Self, AppError> {
        let sqlx_user_id = SqlxUuid::from_bytes(user.id.into_bytes());

        let uuid = Uuid::new_v4();
        let session_id = SqlxUuid::from_bytes(uuid.into_bytes());

        db.session
            .insert_session(InsertSessionParams {
                id: session_id,
                user_id: sqlx_user_id,
                client_meta: client_meta.clone(),
            })
            .await?;

        Ok(UserSession {
            id: session_id,
            user_id: user.id,
            primary_library: user.primary_library.id,
            client_meta,
        })
    }
}

#[derive(Serialize)]
pub struct GetUserSessionsResponse {
    data: Vec<UserSession>,
}

pub async fn get_user_sessions(
    State(state): State<AppState>,
    session: UserSession,
) -> Result<Json<GetUserSessionsResponse>, AppError> {
    let sessions = state.db.session.get_by_user(session.id).await?;
    Ok(Json(GetUserSessionsResponse { data: sessions }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_util::{self, mock_session};

    #[tokio::test]
    async fn test_session_crud() {
        let db = test_util::create_test_db().await;
        let user = test_util::mock_user(&db, String::from("test_session_crud@air.day")).await;
        let session = mock_session(&db, user).await;
        let existing_session = db.session.get_by_id(session.id).await.unwrap();
        assert!(existing_session.is_some());
    }
}
