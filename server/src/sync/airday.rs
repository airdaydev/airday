use axum::extract::ws::Message;
use flatbuffers::FlatBufferBuilder;
use uuid::Uuid;

use crate::{
    AppState,
    common::error::AppError,
    model::item::{Item, ItemAttributes},
    sync::{
        outgoing::create_airday_message_with_builder,
        proto_generated::proto::{
            AirdayActionProto, AirdayBatchComponentProto, AirdayBatchComponentProtoArgs,
            AirdayMessageProto, AuthenticateResponseProto, AuthenticateResponseProtoArgs,
        },
        websocket::send_to_client,
    },
};

pub struct AirdayMessage {
    // TODO: We should match the id 100%, interior actions just need a tick
    pub actions: Vec<AirdayAction>,
}

pub enum AirdayAction {
    Authenticate { session_token: String },
    AddItem { item: Item }, // TODO: possible properties not this
                            // DeleteItem { id: String },
}

impl AirdayMessage {
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
                AirdayActionProto::AddItemActionProto => {
                    let action = batch_component
                        .action_as_add_item_action_proto()
                        .ok_or(AppError::ValidationError(String::from(
                            "Could not parse add item action",
                        )))
                        .unwrap();
                    let item_buffer = action
                        .item()
                        .ok_or(AppError::ValidationError(String::from(
                            "Could not parse add item action",
                        )))
                        .unwrap();

                    let id = Uuid::from_bytes(item_buffer.id().bytes()[0..16].try_into().unwrap());
                    let workspace_id =
                        Uuid::from_bytes(item_buffer.id().bytes()[0..16].try_into().unwrap());
                    let item = Item {
                        id: Uuid::from_bytes(item_buffer.id().bytes()),
                        workspace_id: item_buffer.id(),
                        attributes: ItemAttributes { text: None },
                    };
                    actions.push(AirdayAction::AddItem { item });
                    println!(
                        "Received add item message, {:?}",
                        action.item().unwrap().id()
                    );
                }
                AirdayActionProto::DeleteItemActionProto => {
                    let action = batch_component
                        .action_as_delete_item_action_proto()
                        .unwrap();
                    println!("Received delete item message {:?}", action.id().unwrap());
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

// TODO: Unwrap errors to be sent as error responses (for that message)
pub async fn message_handler(state: &AppState, message: &AirdayMessage, socket_id: &Uuid) -> () {
    let mut builder = FlatBufferBuilder::new();
    let mut action_offsets = vec![];
    for action in &message.actions {
        match action {
            AirdayAction::Authenticate { session_token } => {
                // TODO: We should ok_or this and propagate errors up
                let session_option = state.db.session.get_by_token(&session_token).await.unwrap();
                // TODO: SECURITY! VALIDATE THE SESSION!!
                if let Some(sesh) = session_option {
                    {
                        // Mutex scope
                        let mut map = state.ws_connection_map.lock().unwrap();
                        if let Some(conn) = map.get_mut(&socket_id) {
                            conn.user_id = Some(sesh.user_id);
                        } else {
                            // TODO: this could happen if a the user dc'd while this was still going on
                            println!("User disconnected while authenticated in ws");
                            return ();
                        }
                    };
                    println!("User {:?} authenticated!", sesh.user_id);
                    let action_offset = AuthenticateResponseProto::create(
                        &mut builder,
                        &AuthenticateResponseProtoArgs { success: true },
                    )
                    .as_union_value();
                    let offset = AirdayBatchComponentProto::create(
                        &mut builder,
                        &AirdayBatchComponentProtoArgs {
                            action_type: AirdayActionProto::AuthenticateResponseProto,
                            action: Some(action_offset),
                        },
                    );
                    action_offsets.push(offset);
                }
            }
        }
    }
    let msg = create_airday_message_with_builder(&mut builder, action_offsets);
    send_to_client(&state, &socket_id, Message::Binary(msg.into())).await;
}
