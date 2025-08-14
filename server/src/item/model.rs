use std::pin::Pin;

use crate::{
    common::{error::AppError, utils::proto_uuid_to_uuid},
    sync::proto_generated::proto::ItemProto,
};
use async_trait::async_trait;
use chrono::NaiveDateTime;
use crdt::timestamp::LWWTimestamp;
use crdt::{LWWRegister, timestamp::now_micros};
use serde::{Deserialize, Serialize};
use sqlx::prelude::FromRow;
use uuid::Uuid;

#[derive(Deserialize, Serialize)]
struct LWWDefinitionJson<T> {
    utc: f64,
    pid: f64,
    data: T,
}

impl<T: Clone> LWWDefinitionJson<T> {
    pub fn to_lww(&self) -> LWWRegister<T> {
        let timestamp = LWWTimestamp {
            utc: self.utc as u64,
            pid: self.pid as u64,
        };
        LWWRegister {
            timestamp,
            data: self.data.clone(),
        }
    }
}

#[derive(Debug)]
pub struct ItemAttributes {
    pub text: Option<LWWRegister<String>>,
}

pub struct Item {
    pub id: Uuid,
    pub library_id: Uuid,
    pub attributes: ItemAttributes,
    pub updated_utc: Option<u64>,
    pub tombstone_utc: Option<u64>,
}

impl Item {
    pub fn from_item_proto<'a>(item_proto: &'a ItemProto) -> Item {
        let lww = item_proto.text().unwrap();
        let timestamp = lww.timestamp().unwrap();
        let text_lww = LWWRegister {
            timestamp: LWWTimestamp {
                utc: timestamp.utc() as u64,
                pid: timestamp.pid() as u64,
            },
            data: lww.data().unwrap().to_string(),
        };
        Item {
            id: proto_uuid_to_uuid(item_proto.id()),
            library_id: proto_uuid_to_uuid(item_proto.library_id()),
            updated_utc: Some(now_micros()), // TODO?
            attributes: ItemAttributes {
                text: Some(text_lww),
            },
            tombstone_utc: None,
        }
    }
}

impl ItemAttributes {
    fn new() -> Self {
        ItemAttributes { text: None }
    }
}

impl From<ItemAttributesJson> for ItemAttributes {
    fn from(attr_json: ItemAttributesJson) -> ItemAttributes {
        let mut attrs = ItemAttributes { text: None };
        if let Some(text) = attr_json.text {
            attrs.text = Some(text.to_lww())
        }
        attrs
    }
}

// Should serialize/deserialize to this
#[derive(sqlx::FromRow, Deserialize, Serialize)]
pub struct ItemAttributesJson {
    text: Option<LWWDefinitionJson<String>>,
}

pub fn convert_item_attributes_to_json(
    attributes: &ItemAttributes,
) -> Result<JsonAttributes, AppError> {
    let mut json_attrs = ItemAttributesJson { text: None };

    // Convert text attribute if it exists
    if let Some(text_lww) = &attributes.text {
        json_attrs.text = Some(LWWDefinitionJson {
            utc: text_lww.timestamp.utc as f64,
            pid: text_lww.timestamp.pid as f64,
            data: text_lww.data.clone(),
        });
    }

    // Serialize to JSON
    let json_value = serde_json::to_value(json_attrs)
        .map_err(|err| AppError::ServerError(format!("Failed to serialize attributes: {}", err)))?;

    Ok(Some(json_value))
}

impl ItemAttributes {
    pub fn merge<'a>(&'a mut self, attrs: &ItemAttributes) -> &'a ItemAttributes {
        // Merging text
        if let Some(text) = &attrs.text {
            if let Some(self_text) = &self.text {
                // case 1: attr does exist, merge via app logic
                // TODO: Ergonomics!
                let lww_a = self_text.clone();
                let lww_b = text.clone();
                let merged = lww_a.merge(lww_b).unwrap();
                self.text = Some(merged);
            } else {
                // case 2: attr doesn't exist on self, replace
                self.text = Some(text.clone());
            }
        }
        // TODO: Repeat for each attribute (after improving ergonomics)
        self
    }
}

pub type JsonAttributes = Option<serde_json::Value>;

#[derive(FromRow)]
pub struct SqlItem {
    // static attrs
    pub id: Uuid,
    pub library_id: Uuid,
    // dynamic attrs (lww-map)
    pub attributes: JsonAttributes,
    // metadata
    pub updated_utc: NaiveDateTime,
    pub tombstone_utc: Option<NaiveDateTime>,
}

// TODO: Implement Item * Item from SqlItem (Maybe?)
// pub struct Item {
//     pub id: Uuid,
//     pub library_id: Uuid,
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
    fn get_by_library_stream<'a>(
        &'a self,
        library_id: &Uuid,
        server_timestamp: u64,
    ) -> Pin<
        Box<dyn futures_util::Stream<Item = Result<SqlItem, sqlx::Error>> + std::marker::Send + 'a>,
    >;
    // async fn merge(&self, item: &Item) -> Result<(), AppError>;
    async fn merge_many(&self, item: &Vec<Item>) -> Result<(), AppError>;
    // async fn insert(&self, item: &Item) -> Result<(), AppError>;
    // async fn get_by_id(&self, id: &Uuid) -> Result<Option<Item>, AppError>;
}
