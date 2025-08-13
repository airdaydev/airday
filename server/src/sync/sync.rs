use crdt::{
    LWWRegister,
    timestamp::{LWWTimestamp, now_micros},
};
use flatbuffers::FlatBufferBuilder;
use uuid::Uuid;

use crate::{
    AppState,
    common::{error::AppError, utils::proto_uuid_to_uuid},
    item::model::{Item, ItemAttributes},
    sync::{
        auth::has_library_access,
        proto_generated::proto::{MessageProto, ResourceType},
        response::{ack, create_batch_sync_message, wrap_message},
        websocket::send_to_client,
    },
};

pub struct AirdayMessage {
    // TODO: We should match the id 100%, interior actions just need a tick
    // pub actions: Vec<AirdayAction>,
}

// TODO: Temporary name
pub enum AirdayMessageType {
    Authenticate {
        session_token: String,
    },
    StreamReq {
        library_id: Uuid,
        resource: ResourceType,
        timestamp: u64,
    },
}

pub enum BatchAction {
    SyncItem { item: Item, action_id: Uuid },
}

impl AirdayMessage {
    // TODO: Deal with unwraps
    pub fn from_proto(message: &MessageProto) -> Result<Self, AppError> {
        let mut actions = Vec::new();
        let batch = message
            .batch()
            .ok_or(AppError::ValidationError(String::from(
                "No actions found in mesage",
            )))?;
        if batch.len() == 0 {
            return Err(AppError::ValidationError(String::from(
                "No actions found in message",
            )));
        }
        // 0 actions = we should drop this and warn / print
        for batch_component in message.batch().unwrap() {
            let action_id = if let Some(action_id) = batch_component.action_id() {
                proto_uuid_to_uuid(action_id)
            } else {
                return Err(AppError::ValidationError(String::from("No action_id")));
            };
            match batch_component.action_type() {
                AirdayActionProto::SyncItemActionProto => {
                    let action = batch_component
                        .action_as_sync_item_action_proto()
                        .ok_or(AppError::ValidationError(String::from(
                            "Could not parse add item action",
                        )))
                        .unwrap();
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
                    actions.push(AirdayAction::SyncItem { item, action_id });
                }
                AirdayActionProto::SyncStreamReqProto => {
                    let action = batch_component.action_as_sync_stream_req_proto().unwrap();
                    let library_id = proto_uuid_to_uuid(action.library_id());
                    actions.push(AirdayAction::StreamReq {
                        timestamp: now_micros(),
                        library_id,
                        resource: action.resource(),
                    })
                }
                _ => {
                    println!("BROKEN");
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
pub async fn process_sync_batch(
    state: &AppState,
    message: &AirdayMessage,
    socket_id: &Uuid,
) -> Result<(), AppError> {
    let mut builder = FlatBufferBuilder::new();
    let mut action_offsets = vec![];
    let Some(conn) = state.ws.get_conn(socket_id) else {
        // Connection may have ended before messages were processed
        return Ok(());
    };
    // Collect items for trx merge
    // let mut items = Vec::new();
    for action in &message.actions {
        match action {
            AirdayAction::SyncItem { item, action_id } => {
                if !has_library_access(state, conn.user_id, item.library_id).await {
                    return Ok(());
                }
                // items.push(item.clone());
                let _ = state.db.item.merge(&item).await;
                let action_offset = ack(&mut builder, action_id).await?;
                action_offsets.push(action_offset);
                // TODO: fan out notification
                // (channels(?) for single server, redis fb w channel name for multi server)
            }
        }
    }
    let message_offset = create_batch_sync_message(&mut builder, action_offsets);
    let wrapper = wrap_message(&mut builder, MessageProto::BatchSyncProto, message_offset);
    send_to_client(&state, &socket_id, wrapper).await;
    Ok(())
}
