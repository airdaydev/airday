use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
// use futures_util::SinkExt;
use futures_util::stream::{SplitSink, SplitStream, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

use crate::AppState;

// auth handler
// channel: sync
// type: create_item
// data: serialised_item
//
// https://docs.rs/axum/latest/axum/extract/ws/index.html
// https://github.com/tokio-rs/axum/blob/main/examples/websockets/src/main.rs

pub async fn handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    println!("websocket handler lets goooo {}", state.config.host);
    // TODO: Unwrap cookie auth here
    ws.on_upgrade(handle_socket)
}

#[derive(Debug, Deserialize, Serialize)]
struct CreateItemMessage {}

pub struct WebsocketClient {
    id: Uuid,
    user_id: Option<Uuid>,
    sender: SplitSink<WebSocket, Message>,
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

struct OutgoingMessage {
    client_id: String,
    content: String,
}

async fn handle_socket(socket: WebSocket) {
    // TODO: Evaluate move to async mutex after access patterns established!
    let (sender, receiver) = socket.split();

    tokio::spawn(write(sender));
    tokio::spawn(read(receiver));
}

async fn read(mut receiver: SplitStream<WebSocket>) {
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                println!("Received text: {}", text);
            }
            Ok(Message::Binary(b)) => {
                println!("Received binary message: {:?}", b.len());
            }
            Ok(Message::Ping(_)) => {}
            Ok(Message::Pong(_)) => {}
            Ok(Message::Close(_)) => {}
            Err(e) => {
                eprintln!("Error receiving message: {:?}", e);
                // TODO: Disconnect client
                break;
            }
        }
    }
}

async fn write(_sender: SplitSink<WebSocket, Message>) {
    println!("Received message");
}
