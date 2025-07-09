use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use futures_util::SinkExt;
use tokio::sync::mpsc;
// use futures_util::SinkExt;
use super::proto_generated::proto::root_as_message_wrapper_proto;
use crate::AppState;
use crate::model::user::User;
use crate::sync::airday::{AirdayMessage, message_handler};
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

// TODO: e.g. like client upgrades
pub const PUBLIC_CHANNEL: &str = "public";

// fn userWSChannel(id: Uuid) -> String {
//     format!("user_{}", id)
// }

// fn accountWSChannel(id: Uuid) -> String {
//     format!("account_{}", id)
// }

type WSRoomName = String;

pub struct WebsocketConn {
    id: Uuid,
    sender: mpsc::Sender<Message>,
    user_id: Option<User>,
}

pub type WSSubMap = Arc<Mutex<HashMap<WSRoomName, WebsocketConn>>>;
pub fn build_ws_sub_map() -> WSSubMap {
    Arc::new(Mutex::new(HashMap::new()))
}

pub type WSConnectionMap = Arc<Mutex<HashMap<Uuid, WebsocketConn>>>;
pub fn build_ws_conn_map() -> WSConnectionMap {
    Arc::new(Mutex::new(HashMap::new()))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    // TODO: Evaluate move to async mutex after access patterns established!
    let (sender, receiver) = socket.split();
    let (tx, rx) = mpsc::channel::<Message>(100);
    let socket_id = Uuid::new_v4();
    let connection = WebsocketConn {
        id: socket_id,
        sender: tx,
        user_id: None,
    };
    state
        .ws_connection_map
        .lock()
        .unwrap()
        .insert(socket_id, connection);
    tokio::spawn(read(state, receiver, socket_id));
    tokio::spawn(write(sender, rx));
}

async fn read(state: AppState, mut receiver: SplitStream<WebSocket>, socket_id: Uuid) {
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
                            message_handler(&state, &msg, &socket_id).await;
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
    state.ws_connection_map.lock().unwrap().remove(&socket_id);
}

async fn write(mut sender: SplitSink<WebSocket, Message>, mut rx: mpsc::Receiver<Message>) {
    while let Some(message) = rx.recv().await {
        if let Err(err) = sender.send(message).await {
            eprintln!("Failed to send: {:?}", err);
            break;
        }
    }
    println!("Received message");
}

pub async fn send_to_client(state: &AppState, client_id: &Uuid, message: Message) {
    let sender = {
        let mut connections = state.ws_connection_map.lock().unwrap();
        connections
            .get_mut(client_id)
            .map(|client| client.sender.clone())
    };
    if let Some(sender) = sender {
        let _ = sender.send(message).await;
        // TODO: Show error! Consider disconnecting?
    }
}
