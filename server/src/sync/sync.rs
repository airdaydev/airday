use crate::{
    AppState,
    common::{error::AppError, utils::proto_uuid_to_uuid},
    item::model::{Item, ItemAttributes},
    sync::{
        auth::has_library_access,
        proto_generated::proto::{ActionProto, BatchSyncProto, BatchSyncProtoArgs},
        response::ack,
    },
};
use crdt::{
    LWWRegister,
    timestamp::{LWWTimestamp, now_micros},
};
use flatbuffers::{FlatBufferBuilder, UnionWIPOffset, WIPOffset};
use uuid::Uuid;

pub enum BatchAction {
    SyncItem { item: Item, action_id: Uuid },
    Ack { item: Item, action_id: Uuid },
    Error { message: String },
}

pub struct BatchSync {
    // TODO: We should match the id 100%, interior actions just need a tick
    pub actions: Vec<BatchAction>,
}

impl BatchSync {
    // TODO: Deal with unwraps
    pub fn from_proto(message: &BatchSyncProto) -> Result<Self, AppError> {
        let mut actions = Vec::new();
        if message.batch().len() == 0 {
            return Err(AppError::ValidationError(String::from(
                "No actions found in message",
            )));
        }
        // 0 actions = we should drop this and warn / print
        for batch_component in message.batch() {
            let action_id = proto_uuid_to_uuid(batch_component.action_id());
            match batch_component.action_type() {
                ActionProto::SyncItemActionProto => {
                    let action = batch_component.action_as_sync_item_action_proto().ok_or(
                        AppError::ValidationError(String::from("Could not parse add item action")),
                    )?;
                    let item_buffer = action.item();

                    let id = proto_uuid_to_uuid(item_buffer.id());
                    let library_id = proto_uuid_to_uuid(item_buffer.library_id());
                    // TODO: UNWRAP ITEM IN SEPARATE FUNC
                    let lww = item_buffer.text().unwrap();
                    let timestamp = lww.timestamp().unwrap();
                    let text_lww = LWWRegister {
                        timestamp: LWWTimestamp {
                            utc: timestamp.utc() as u64,
                            pid: timestamp.pid() as u64,
                        },
                        data: lww.data().unwrap().to_string(),
                    };
                    let item = Item {
                        id,
                        library_id,
                        updated_utc: Some(now_micros()),
                        tombstone_utc: None,
                        attributes: ItemAttributes {
                            text: Some(text_lww),
                        },
                    };
                    actions.push(BatchAction::SyncItem { item, action_id });
                }
                _ => {
                    // TODO: Fail fast?
                    return Err(AppError::ValidationError(String::from(
                        "Unknown message type",
                    )));
                }
            }
        }
        Ok(Self { actions })
    }
}

// TODO: Create error resposes for each message
pub async fn process_sync_batch<'a>(
    state: &AppState,
    message: &BatchSyncProto<'a>,
    user_id: &Uuid,
) -> Vec<BatchAction> {
    let mut action_offsets = vec![];
    let mut responses = Vec::new();
    let mut itemTrx;
    let mut listTrx;
    for batch_component in &message.batch() {
        match batch_component.action_type() {
            ActionProto::SyncItemActionProto => {
                let Some(action) = batch_component.action_as_sync_item_action_proto() else {
                    // Error!
                    responses.push(BatchAction::Error {
                        message: String::from("invalid message"),
                    });
                    continue;
                };
                let library_id = action.item().library_id();
                if !has_library_access(state, user_id, library_id).await {
                    responses.push()
                }
                // items.push(item.clone());
                let _ = state.db.item.merge(&item).await;
                let action_offset = ack(&mut builder, action_id).await;
                action_offsets.push(action_offset);
                // TODO: fan out notification
                // (channels(?) for single server, redis fb w channel name for multi server)
            }
            _ => {
                // Generate error
            }
        }
    }
    responses
}

pub fn build_batch_sync_msg<'a>(
    builder: &'a mut FlatBufferBuilder,
    _actions: Vec<BatchAction>,
) -> WIPOffset<UnionWIPOffset> {
    let batch_offset = BatchSyncProto::create(
        builder,
        &BatchSyncProtoArgs {
            stream_context: None,
            batch: None,
        },
    )
    .as_union_value();
    batch_offset
}
