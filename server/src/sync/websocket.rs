use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
// use futures_util::SinkExt;
use super::proto_generated::proto::root_as_message_wrapper_proto;
use crate::AppState;
use crate::model::user::User;
use crate::sync::airday::{self, AirdayMessage, message_handler};
use crate::sync::proto_generated::proto::MessageProto;
use futures_util::stream::{SplitSink, SplitStream, StreamExt};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

// auth handler
// channel: sync
// type: create_item
// data: serialised_item
//
// https://docs.rs/axum/latest/axum/extract/ws/index.html
// https://github.com/tokio-rs/axum/blob/main/examples/websockets/src/main.rs

pub async fn handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    // TODO: Unwrap cookie auth here
    ws.on_upgrade(|socket| async move {
        handle_socket(socket, state).await;
    })
}

pub struct WebsocketClient {
    id: Uuid,
    sender: SplitSink<WebSocket, Message>,
    user_id: Option<User>,
}

// TODO: e.g. like client upgrades
pub const PUBLIC_CHANNEL: &str = "public";

// fn userWSChannel(id: Uuid) -> String {
//     format!("user_{}", id)
// }

// fn accountWSChannel(id: Uuid) -> String {
//     format!("account_{}", id)
// }

type WSRoomName = String;

pub type WSSubMap = Arc<Mutex<HashMap<WSRoomName, WebsocketClient>>>;
pub fn build_ws_sub_map() -> WSSubMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub type WSConnectionMap = Arc<Mutex<HashMap<Uuid, WebsocketClient>>>;
pub fn build_ws_conn_map() -> WSConnectionMap {
    Arc::new(Mutex::new(HashMap::new()))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    // TODO: Evaluate move to async mutex after access patterns established!
    let (sender, receiver) = socket.split();

    tokio::spawn(write(sender));
    tokio::spawn(read(state, receiver));
}

async fn read(state: AppState, mut receiver: SplitStream<WebSocket>) {
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(b)) => {
                let msg = root_as_message_wrapper_proto(&b).unwrap();
                match msg.message_type() {
                    // Holy shit man i can just fuck this off and put it as text...
                    MessageProto::JMAPMessageProto => {
                        println!("Dropping JMAP message!");
                    }
                    MessageProto::AirdayMessageProto => {
                        let airday_message = msg.message_as_airday_message_proto().unwrap();
                        let parsed_message = AirdayMessage::from_proto(&airday_message);
                        if let Ok(msg) = parsed_message {
                            message_handler(&state, &msg).await;
                        }
                    }
                    _ => {
                        println!("Throwing away non binary message")
                    }
                }
                ()
            }
            Ok(Message::Close(_)) => {
                // Clean up maps
                println!("Closed")
            }
            Err(e) => {
                eprintln!("Error receiving message: {:?}", e);
                // TODO: Disconnect client
                break;
            }
            _ => {
                // Discard
            }
        }
    }
}

async fn write(_sender: SplitSink<WebSocket, Message>) {
    println!("Received message");
}
