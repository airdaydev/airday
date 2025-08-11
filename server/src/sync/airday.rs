use axum::extract::ws::Message;
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
        outgoing::{ack, create_airday_message_with_builder},
        proto_generated::proto::{
            AirdayActionProto, AirdayBatchComponentProto, AirdayBatchComponentProtoArgs,
            AirdayMessageProto, AuthenticateResponseProto, AuthenticateResponseProtoArgs,
            ResourceType, UuidProto,
        },
        websocket::send_to_client,
    },
};

pub struct AirdayMessage {
    // TODO: We should match the id 100%, interior actions just need a tick
    pub actions: Vec<AirdayAction>,
}

pub enum AirdayAction {
    Authenticate {
        session_token: String,
    },
    SyncItem {
        item: Item,
        action_id: Uuid,
    },
    StreamReq {
        library_id: Uuid,
        resource: ResourceType,
        timestamp: u64,
    },
}

impl AirdayMessage {
    // TODO: Deal with unwraps
    pub fn from_proto(message: &AirdayMessageProto) -> Result<Self, AppError> {
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
                AirdayActionProto::AuthenticateActionProto => {
                    println!("Received authentication request");
                    let action = batch_component
                        .action_as_authenticate_action_proto()
                        .ok_or(AppError::ValidationError(String::from(
                            "Could not parse authenticate action",
                        )))?;
                    let token =
                        action
                            .session_token()
                            .ok_or(AppError::ValidationError(String::from(
                                "Authenticate action is missing session_token",
                            )))?;
                    actions.push(AirdayAction::Authenticate {
                        session_token: String::from(token),
                    })
                }
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
pub async fn message_handler(
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
            AirdayAction::Authenticate { session_token } => {
                // TODO: We should ok_or this and propagate errors up
                let session_option = state.db.session.get_by_token(&session_token).await.unwrap();
                // TODO: SECURITY! VALIDATE THE SESSION!!
                if let Some(sesh) = session_option {
                    let set_conn_user_id: bool = {
                        // Mutex scope
                        let mut map = state.ws.conn_map.lock().unwrap();
                        if let Some(conn) = map.get_mut(&socket_id) {
                            conn.user_id = Some(sesh.user_id);
                            true
                        } else {
                            false
                        }
                    };
                    if set_conn_user_id == false {
                        // TODO: SPAN!?
                        println!("WS: User disconnected while authenticating");
                        return Ok(());
                    }
                    // TODO: Span?
                    println!("User {:?} authenticated!", sesh.user_id);
                    // TODO: Don't panic!
                    if let Some(user) = state.db.user.get_by_id(&sesh.user_id).await.unwrap() {
                        let action_offset = AuthenticateResponseProto::create(
                            &mut builder,
                            &AuthenticateResponseProtoArgs {
                                user_id: Some(&UuidProto::new(sesh.user_id.as_bytes())),
                                library_id: Some(&UuidProto::new(
                                    user.primary_library.unwrap().id.as_bytes(),
                                )),
                            },
                        )
                        .as_union_value();
                        let offset = AirdayBatchComponentProto::create(
                            &mut builder,
                            &AirdayBatchComponentProtoArgs {
                                action_type: AirdayActionProto::AuthenticateResponseProto,
                                action: Some(action_offset),
                                action_id: None,
                            },
                        );
                        action_offsets.push(offset);
                    }
                }
            }
            AirdayAction::SyncItem { item, action_id } => {
                if !has_library_access(state, conn.user_id, item.library_id).await {
                    return Ok(());
                }
                // items.push(item.clone());
                let _ = state.db.item.merge(&item).await;
                let ack_offset = ack(&mut builder, action_id).await?;
                action_offsets.push(ack_offset);
                // TODO: fan out notification
                // (channels(?) for single server, redis fb w channel name for multi server)
            }
            AirdayAction::StreamReq {
                library_id,
                resource,
                timestamp,
            } => {
                if !has_library_access(state, conn.user_id, *library_id).await {
                    return Ok(());
                }
                // loop through requested resources and send until end
                match *resource {
                    ResourceType::Item => {
                        // get items affected since timestamp - 1minute
                    }
                    ResourceType::List => {
                        // get lists affected since timestamp - 1minute
                    }
                    _ => {}
                }
                // send_to_client(state, socket_id, message).await;
                // on end (OR ERROR), send a end message to close the stream
                // TODO: Ensure this attempts in an own thread (i forget context)
            }
        }
    }
    let msg = create_airday_message_with_builder(&mut builder, action_offsets);
    send_to_client(&state, &socket_id, Message::Binary(msg.into())).await;
    Ok(())
}
