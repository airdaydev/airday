use async_trait::async_trait;
use serde::Serialize;
use uuid::Uuid;

use crate::common::error::AppError;

// Creating a workspace
#[derive(Serialize, Debug, Clone)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
}

#[async_trait]
pub trait WorkspaceModel: Send + Sync {
    async fn _create(&self, owner_id: &Uuid) -> Result<Workspace, AppError>;
}
