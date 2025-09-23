use crate::AppState;
use crate::auth::auth::auth_websocket;
use crate::common::error::AppError;
use crate::common::utils::proto_uuid_to_uuid;
use crate::sync_engine::engine::IncomingSyncMsg;
use crate::sync_transport::fb::{
    build_batch_sync_msg, build_error_response_message, create_auth_response, wrap_message,
};
use crate::sync_transport::proto_generated::proto::{
    ActionProto, MessageProto, MessageWrapperProto, OpKind, root_as_message_wrapper_proto,
};
use crate::sync_transport::sync::process_sync_batch;
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use bytes::Bytes;
use flatbuffers::FlatBufferBuilder;
use futures_util::SinkExt;
use futures_util::stream::{SplitSink, SplitStream, StreamExt};
use opentelemetry::trace::{SpanContext, TraceContextExt, TraceState};
use opentelemetry::{Context, TraceId};
use opentelemetry::{SpanId, TraceFlags};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;
use tracing::{Instrument, Span, info_span};
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

async fn handle_websocket_error(state: &AppState, socket_id: Uuid, error: AppError) {
    println!("Websocket reply error!!, {:?}", error);
    let err_msg =
        build_error_response_message(&String::from("Failed to parse SyncStreamReqProto"), None);
    send_to_client(&state, &socket_id, err_msg).await;
}

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

async fn read(state: AppState, mut receiver: SplitStream<WebSocket>, socket_id: Uuid) {
    while let Some(msg) = receiver.next().await {
        let result: Result<(), AppError> = async {
            let cur_span = Span::current();
            match msg {
                Ok(Message::Binary(b)) => {
                    cur_span.set_attribute("message_type", "binary");
                    // Set trace id
                    let msg = root_as_message_wrapper_proto(&b)?;
                    // TODO: Let's catch errors here to hit back error to client
                    // TODO: Separate function
                    let span_ctx = extract_span_ctx(msg);
                    let parent_ctx = Context::current().with_remote_span_context(span_ctx);
                    cur_span.set_parent(parent_ctx);
                    match msg.message_type() {
                        MessageProto::AuthenticateActionProto => {
                            let Some(msg) = msg.message_as_authenticate_action_proto() else {
                                return Err(AppError::ValidationError(String::from(
                                    "Failed to parse AuthenticateActionProto",
                                )));
                            };
                            // TODO: A validate session token function that returns session & user
                            let Some(session_token) = msg.session_token() else {
                                return Err(AppError::ValidationError(String::from(
                                    "No session token provided",
                                )));
                            };
                            let Ok(sesh) = auth_websocket(&state, session_token, &socket_id).await
                            else {
                                return Err(AppError::ValidationError(String::from(
                                    "Invalid session token",
                                )));
                            };
                            if let Ok(result) = state.db.user.get_by_id(&sesh.user_id).await {
                                if let Some(user) = result {
                                    let mut builder = FlatBufferBuilder::new();
                                    let auth_offset = create_auth_response(&mut builder, &user);
                                    let msg = wrap_message(
                                        &mut builder,
                                        MessageProto::AuthenticateResponseProto,
                                        auth_offset,
                                    );
                                    send_to_client(&state, &socket_id, msg).await;
                                    return Ok(());
                                }
                            } else {
                                // User does not exist
                                return Err(AppError::ValidationError(String::from(
                                    "Invalid session token",
                                )));
                            }
                            // Authenticate user
                        }
                        MessageProto::BatchSyncProto => {
                            let Some(msg) = msg.message_as_batch_sync_proto() else {
                                return Err(AppError::ValidationError(String::from(
                                    "Failed to parse BatchSyncProto",
                                )));
                            };
                            let Some(conn) = state.ws.get_conn(&socket_id) else {
                                // Connection no longer exists
                                // TODO: Log
                                return Ok(());
                            };
                            let Some(user_id) = conn.user_id else {
                                return Err(AppError::ValidationError(String::from(
                                    "Unauthorised session",
                                )));
                            };
                            let mut op_vec: Vec<IncomingSyncMsg> = Vec::new();
                            for ap in msg.batch().iter() {
                                if ap.action_type() == ActionProto::SyncOpActionProto {
                                    // TODO: Break this whole thing so we can propagate an error back to the top and send
                                    // Zero-copy body & encapsulate
                                    let op_raw = ap.action_as_sync_op_action_proto().unwrap();
                                    let payload_slice = op_raw.payload().unwrap().bytes();
                                    let start =
                                        payload_slice.as_ptr() as usize - b.as_ptr() as usize;
                                    let end = start + payload_slice.len();
                                    let payload_range = start..end;
                                    let op_kind = op_raw.op_kind();
                                    let base_seq = if op_kind == OpKind::SNAPSHOT {
                                        Some(op_raw.base_seq())
                                    } else {
                                        None
                                    };
                                    let op = IncomingSyncMsg {
                                        base_seq: base_seq,
                                        op_kind: op_kind.0,
                                        library_id: proto_uuid_to_uuid(op_raw.library_id()),
                                        obj_id: proto_uuid_to_uuid(op_raw.obj_id()),
                                        obj_kind: op_raw.obj_kind(),
                                        path: op_raw.path(), // 0 = no path
                                        payload_range,
                                        tombstone_utc: None, // TODO: tombstoning
                                    };
                                    op_vec.push(op);
                                }
                            }
                            if op_vec.is_empty() {
                                // Fail early
                                panic!("lol");
                            }
                            // Run transactions
                            // TODO: Process inside another worker, and optionally send an ack here
                            // process_ops(msg_data: Bytes::from(b), op_vec);
                            let responses = process_sync_batch(&state, &msg, &user_id).await;
                            // Send response batch
                            let mut builder = FlatBufferBuilder::new();
                            let message_offset = build_batch_sync_msg(&mut builder, responses);
                            let wrapper = wrap_message(
                                &mut builder,
                                MessageProto::BatchSyncProto,
                                message_offset,
                            );
                            send_to_client(&state, &socket_id, wrapper).await;
                        }
                        MessageProto::SyncStreamReqProto => {
                            let Some(msg) = msg.message_as_sync_stream_req_proto() else {
                                return Err(AppError::ValidationError(String::from(
                                    "Failed to parse SyncStreamReqProto",
                                )));
                            };
                            // TODO: Authorise
                            // Validate and start sync stream
                            let _library_id = proto_uuid_to_uuid(msg.library_id());
                            // Start stream;
                            //                                 timestamp: now_micros(),
                            // library_id,
                            // resource: action.resource(),
                        }
                        _ => {
                            // Ignore message
                        }
                    }
                    Ok(())
                }
                Ok(Message::Close(_)) => {
                    cur_span.record("message_type", "close");
                    Ok(())
                }
                Err(_) => {
                    cur_span.record("message_type", "error");
                    Ok(())
                }
                _ => {
                    // Discard
                    Ok(())
                }
            }
        }
        .instrument(info_span!("ws_receive", socket_id = %socket_id))
        .await;
        // Per message error handler
        if let Err(err) = result {
            handle_websocket_error(&state, socket_id, err);
        }
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

pub async fn send_to_client(state: &AppState, client_id: &Uuid, message: Vec<u8>) {
    let sender = {
        let mut connections = state.ws.conn_map.lock().unwrap();
        connections
            .get_mut(client_id)
            .map(|client| client.sender.clone())
    };
    if let Some(sender) = sender {
        if let Err(err) = sender.send(Message::Binary(message.into())).await {
            eprintln!("Failed to send message to client {}: {:?}", client_id, err);
            // TODO: Consider disconnecting?
        }
    }
}
