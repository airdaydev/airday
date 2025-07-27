use async_trait::async_trait;
use serde::Serialize;
use uuid::Uuid;

use crate::common::error::AppError;

// Creating a library
#[derive(Serialize, Debug, Clone)]
pub struct Library {
    pub id: Uuid,
    pub name: String,
}

#[async_trait]
pub trait LibraryModel: Send + Sync {
    async fn _create(&self, owner_id: &Uuid) -> Result<Library, AppError>;
}
