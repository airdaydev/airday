use async_trait::async_trait;
use serde::Serialize;
use uuid::Uuid;

use crate::common::error::AppError;

// Creating a workspace
#[derive(Serialize)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
}

#[async_trait]
pub trait WorkspaceModel: Send + Sync {
    async fn create_owned(&self, owner_id: &Uuid) -> Result<Workspace, AppError>;
}
