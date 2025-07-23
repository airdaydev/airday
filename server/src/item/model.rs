use std::pin::Pin;

use crate::common::error::AppError;
use async_trait::async_trait;
use chrono::NaiveDateTime;
use crdt::LWWRegister;
use crdt::timestamp::LWWTimestamp;
use futures_util::Stream;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::SqliteRow;
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
struct LWWDefinitionJson<T> {
    utc: f64,
    pid: f64,
    data: T,
}

pub struct ItemAttributes {
    pub text: Option<LWWRegister<String>>,
}

pub struct Item {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub attributes: ItemAttributes,
}

impl ItemAttributes {
    fn new() -> Self {
        ItemAttributes { text: None }
    }
}

// Should serialize/deserialize to this
#[derive(sqlx::FromRow, Deserialize, Serialize)]
pub struct ItemAttributesJson {
    text: Option<LWWDefinitionJson<String>>,
}

impl ItemAttributesJson {
    fn merge(&self, attrs: &ItemAttributes) -> Option<ItemAttributes> {
        let mut attributes = ItemAttributes::new();
        // Merging text
        if let Some(text) = &attrs.text {
            if let Some(self_text) = &self.text {
                // case 1: attr does exist, merge via app logic
                // TODO: Ergonomics!
                let lww_a = LWWRegister::new(
                    self_text.data.clone(),
                    Some(LWWTimestamp::new(
                        Some(self_text.utc as u64),
                        Some(self_text.pid as u64),
                    )),
                )
                .unwrap();
                let lww_b = LWWRegister::new(
                    text.data.clone(),
                    Some(LWWTimestamp::new(
                        Some(text.timestamp.utc),
                        Some(text.timestamp.pid),
                    )),
                )
                .unwrap();
                let merged = lww_a.merge(lww_b).unwrap();
                attributes.text = Some(merged);
            } else {
                // case 2: attr doesn't exist on self, replace
                attributes.text = Some(text.clone());
            }
        }
        // TODO: Repeat for each attribute (after improving ergonomics)
        Some(attributes)
    }
}

pub type JsonAttributes = Option<serde_json::Value>;

pub struct SqlItem {
    // static attrs
    pub id: Uuid,
    pub workspace_id: Uuid,
    // dynamic attrs (lww-map)
    pub attributes: JsonAttributes,
    // metadata
    pub updated_utc: NaiveDateTime,
    pub tombstone_utc: Option<NaiveDateTime>,
}

// TODO: Implement Item * Item from SqlItem (Maybe?)
// pub struct Item {
//     pub id: Uuid,
//     pub workspace_id: Uuid,
//     pub text: Option<LWWRegister<>>,
// }

// impl From<SqlItem> for Item {
//     fn from(sql_item: SqlItem) -> Self {
//         Self {
//             id: sql_item.id,
//             // TODO: back and forth between json type
//             // text: LWWRegister<>::from_string(String::from("Test")),
//         }
//     }
// }

#[async_trait]
pub trait ItemModel: Send + Sync {
    // Accept query options
    async fn get_by_workspace(
        &self,
        // workspace: &Uuid,
    ) -> Pin<Box<dyn Stream<Item = Result<SqliteRow, AppError>> + Send>>;
    async fn merge(&self, workspace_id: &Uuid, item: &Item) -> Result<(), AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}
