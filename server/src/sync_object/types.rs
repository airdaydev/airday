// use ts_rs::TS;

// TODO: generate typescript types (or find higher level way)
// #[derive(TS)]
// #[ts(export)]
pub mod item_field_id {
    pub const ITEM_TEXT: i16 = 0;
    // -- TODO: item.type could be an enum (repeat, static, series, shuffle, playlist)
    // -- TODO: repeat could be a property...
}

pub mod list_field_id {
    pub const LIST_NAME: i16 = 256;
    pub const LIST_DESCRIPTION: i16 = 257;
}

pub mod sync_object_type {
    pub const ITEM_TYPE: i64 = 0;
    pub const CONTAINER_TYPE: i64 = 1;
}
