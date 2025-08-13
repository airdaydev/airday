use crate::AppState;
use crate::auth::auth::auth_websocket;
use crate::sync::airday::process_sync_batch;
use crate::sync::proto_generated::proto::{
    MessageProto, MessageWrapperProto, root_as_message_wrapper_proto,
};
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use futures_util::SinkExt;
use futures_util::stream::{SplitSink, SplitStream, StreamExt};
use opentelemetry::trace::{SpanContext, TraceContextExt, TraceState};
use opentelemetry::{Context, TraceId};
use opentelemetry::{SpanId, TraceFlags};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tracing::{Instrument, Span, error, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

pub async fn handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    // TODO: Unwrap cookie auth here
    ws.on_upgrade(|socket| async move {
        handle_socket(socket, state).await;
    })
}

#[derive(Clone)]
pub struct WebsocketConn {
    pub sender: mpsc::Sender<Message>,
    pub user_id: Option<Uuid>,
}

pub type WSConnectionMap = Arc<Mutex<HashMap<Uuid, WebsocketConn>>>;

#[derive(Clone)]
pub struct WebsocketState {
    pub conn_map: WSConnectionMap,
}

impl WebsocketState {
    pub fn new() -> Self {
        WebsocketState {
            conn_map: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    pub fn get_conn(&self, socket_id: &Uuid) -> Option<WebsocketConn> {
        let record = self.conn_map.lock().unwrap();
        if let Some(conn) = record.get(socket_id) {
            Some(conn.clone())
        } else {
            None
        }
    }
}

// TODO: If message bus setup, this will redirect messages through external bus
// type WSRoomName = String;
// pub type WSSubMap = Arc<Mutex<HashMap<WSRoomName, WebsocketConn>>>;
// pub fn build_ws_sub_map() -> WSSubMap {
//     Arc::new(Mutex::new(HashMap::new()))
// }

async fn handle_socket(socket: WebSocket, state: AppState) {
    // TODO: Evaluate move to async mutex after access patterns established!
    let (sender, receiver) = socket.split();
    let (tx, rx) = mpsc::channel::<Message>(100);
    let socket_id = Uuid::new_v4();
    let connection = WebsocketConn {
        sender: tx,
        user_id: None,
    };
    state
        .ws
        .conn_map
        .lock()
        .unwrap()
        .insert(socket_id, connection);
    tokio::spawn(read(state, receiver, socket_id));
    tokio::spawn(write(sender, rx));
}

fn extract_span_ctx<'a>(wrapper: MessageWrapperProto<'a>) -> SpanContext {
    let mut otel_trace_id: TraceId = TraceId::INVALID;
    let mut otel_span_id = SpanId::INVALID;
    if let Some(span_context) = wrapper.span_context() {
        if let Some(trace_id) = span_context.trace_id() {
            let trace_id_bytes: [u8; 16] = trace_id.bytes().try_into().unwrap();
            otel_trace_id = TraceId::from_bytes(trace_id_bytes);
        }
        let span_id_bytes: [u8; 8] = span_context.span_id().to_be_bytes();
        otel_span_id = SpanId::from_bytes(span_id_bytes);
    }
    SpanContext::new(
        otel_trace_id,
        otel_span_id,
        TraceFlags::SAMPLED,
        false,
        TraceState::default(),
    )
}

// TODO: The name itself could further be differentiated into message types
async fn read(state: AppState, mut receiver: SplitStream<WebSocket>, socket_id: Uuid) {
    while let Some(msg) = receiver.next().await {
        async {
            let cur_span = Span::current();
            match msg {
                Ok(Message::Binary(b)) => {
                    cur_span.set_attribute("message_type", "binary");
                    // Set trace id
                    let msg = root_as_message_wrapper_proto(&b).unwrap();
                    // TODO: Separate function
                    let span_ctx = extract_span_ctx(msg);
                    let parent_ctx = Context::current().with_remote_span_context(span_ctx);
                    cur_span.set_parent(parent_ctx);
                    match msg.message_type() {
                        MessageProto::AuthenticateActionProto => {
                            let Some(msg) = msg.message_as_authenticate_action_proto() else {
                                // TODO: Authentication invalid response
                                return ();
                            };
                            let Some(session_token) = msg.session_token() else {
                                // TODO: Authentication invalid response
                                return ();
                            };
                            if let Err(err) =
                                auth_websocket(&state, session_token, &socket_id).await
                            {
                                // TODO: Authentication invalid response
                                return ();
                            };
                            // Authenticate user
                        }
                        MessageProto::BatchSyncProto => {
                            let parsed_message = msg.message_as_batch_sync_proto();
                            // Validate and start accepting items
                            // process_sync_batch(state,)
                        }
                        MessageProto::SyncStreamReqProto => {
                            let parsed_message = msg.message_as_sync_stream_req_proto();
                            // Validate and start sync stream
                        }
                        _ => {
                            // Ignore message
                        }
                    }
                    ()
                }
                Ok(Message::Close(_)) => {
                    cur_span.record("message_type", "close");
                }
                Err(_) => {
                    cur_span.record("message_type", "error");
                }
                _ => {
                    // Discard
                }
            }
        }
        .instrument(info_span!("ws_receive", socket_id = %socket_id))
        .await
    }
    state.ws.conn_map.lock().unwrap().remove(&socket_id);
}

async fn write(mut sender: SplitSink<WebSocket, Message>, mut rx: mpsc::Receiver<Message>) {
    while let Some(message) = rx.recv().await {
        if let Err(_) = sender.send(message).await {
            // eprintln!("Failed to send: {:?}", err);
            break;
        }
    }
    // println!("Ending write");
}

pub async fn send_to_client(state: &AppState, client_id: &Uuid, message: Message) {
    let sender = {
        let mut connections = state.ws.conn_map.lock().unwrap();
        connections
            .get_mut(client_id)
            .map(|client| client.sender.clone())
    };
    if let Some(sender) = sender {
        if let Err(err) = sender.send(message).await {
            eprintln!("Failed to send message to client {}: {:?}", client_id, err);
            // TODO: Consider disconnecting?
        }
    }
}
