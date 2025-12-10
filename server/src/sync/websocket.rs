use crate::AppState;
use crate::auth::auth::auth_websocket;
use crate::common::error::AppError;
use crate::common::utils::proto_uuid_to_uuid;
use crate::sync::engine::{IncomingSyncOp, IncomingSyncOpBatch};
use crate::sync::fb::{build_error_response_message, create_auth_response, wrap_message};
use crate::sync::proto_generated::proto::{
    MessageProto, MessageWrapperProto, OpKind, root_as_message_wrapper_proto,
};
use crate::sync::stream::{PER_USER_STREAM_LIMIT, StreamRequest, start_catchup_stream};
use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
use flatbuffers::FlatBufferBuilder;
use futures_util::SinkExt;
use futures_util::stream::{SplitSink, SplitStream, StreamExt};
use opentelemetry::trace::{SpanContext, TraceContextExt, TraceState};
use opentelemetry::{Context, KeyValue, TraceId};
use opentelemetry::{SpanId, TraceFlags};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::Sender;
use tokio::sync::{Semaphore, mpsc};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
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

impl WebsocketConn {
    pub async fn bootstrap_conn(&self, app_state: &AppState) -> Sender<StreamRequest> {
        let cancel = CancellationToken::new();
        let (tx, mut rx) = mpsc::channel::<StreamRequest>(32);
        let stream_semaphore = Arc::new(Semaphore::new(PER_USER_STREAM_LIMIT));
        let mut join_set = JoinSet::<()>::new(); // Keeping track of catch up streams
        // TODO: How to access join_set and publish metrics?
        // TODO: An alernative to a separate task would be to create a loop that loops through

        // Separate task to loop for incoming streams
        tokio::spawn({
            let app_state = app_state.clone();
            let cancel = cancel.clone();
            async move {
                while let Some(req) = rx.recv().await {
                    let app_state = app_state.clone();
                    let cancel = cancel.clone();
                    let permit = match stream_semaphore.clone().try_acquire_owned() {
                        Ok(p) => p,
                        Err(_) => continue, // or send error back
                    };
                    // Separate task to handle & retrieve streams
                    join_set.spawn(async move {
                        // TODO: Cancellation
                        if let Err(err) = start_catchup_stream(app_state, cancel, req).await {
                            println!("{:?}", err); // TODO: Send error back to user
                        }
                        drop(permit);
                    });
                }
            }
        });
        tx.clone()
    }
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
    tracing::error!("{}: {}", error.kind(), error.message());
    let err_msg = build_error_response_message(&String::from(error.kind()), None, None);
    send_to_client(&state.ws, &socket_id, err_msg).await;
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    // TODO: Evaluate move to async mutex after access patterns established!
    let (ws_sender, ws_receiver) = socket.split();
    let (tx, rx) = mpsc::channel::<Message>(100);
    let socket_id = Uuid::new_v4();
    let connection = WebsocketConn {
        sender: tx,
        user_id: None,
    };
    let stream_tx = connection.bootstrap_conn(&state).await;
    state
        .ws
        .conn_map
        .lock()
        .unwrap()
        .insert(socket_id, connection.clone());
    tokio::spawn(read(state.clone(), ws_receiver, socket_id, stream_tx));
    tokio::spawn(write(ws_sender, rx));
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

async fn read(
    state: AppState,
    mut receiver: SplitStream<WebSocket>,
    socket_id: Uuid,
    stream_tx: Sender<StreamRequest>,
) {
    while let Some(msg) = receiver.next().await {
        let result: Result<(), AppError> = async {
            let cur_span = Span::current();
            match msg {
                Ok(Message::Binary(b)) => {
                    // Set trace id
                    let cloned = b.clone();
                    let msg = root_as_message_wrapper_proto(&cloned)?;
                    // drop(msg);
                    // let msg_data = ;
                    // TODO: Let's catch errors here to hit back error to client
                    // TODO: Separate function
                    let span_ctx = extract_span_ctx(msg);
                    let parent_ctx = Context::current().with_remote_span_context(span_ctx);
                    cur_span.set_parent(parent_ctx);
                    let msg_type = msg.message_type();
                    cur_span.record("msg_type", msg_type.variant_name().unwrap_or("unknown"));
                    match msg_type {
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
                            tracing::info!(user_id = %sesh.user_id.to_string(), "User Authenticated");
                            if let Ok(result) = state.db.user.get_by_id(&sesh.user_id).await {
                                if let Some(user) = result {
                                    let mut builder = FlatBufferBuilder::new();
                                    let auth_offset = create_auth_response(&mut builder, &user);
                                    let msg = wrap_message(
                                        &mut builder,
                                        MessageProto::AuthenticateResponseProto,
                                        auth_offset,
                                    );
                                    send_to_client(&state.ws, &socket_id, msg).await;
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
                        MessageProto::BatchSyncOpProto => {
                            let Some(msg) = msg.message_as_batch_sync_op_proto() else {
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
                            cur_span.record("user_id", user_id.to_string());
                            let mut op_vec: Vec<IncomingSyncOp> = Vec::new();
                            for op_raw in msg.batch().iter() {
                                // TODO: Break this whole thing so we can propagate an error back to the top and send
                                // Zero-copy body & encapsulate
                                let payload_slice = op_raw.payload().unwrap().bytes();
                                let start = payload_slice.as_ptr() as usize - b.as_ptr() as usize;
                                let end = start + payload_slice.len();
                                let payload_range = start..end;
                                let op_kind = op_raw.op_kind();
                                let payload = b.slice(payload_range);
                                let base_seq = if op_kind == OpKind::SNAPSHOT {
                                    Some(op_raw.base_seq())
                                } else {
                                    None
                                };
                                let op = IncomingSyncOp {
                                    base_seq: base_seq,
                                    op_kind: op_kind.0,
                                    op_id: proto_uuid_to_uuid(op_raw.op_id()),
                                    library_id: proto_uuid_to_uuid(op_raw.library_id()),
                                    obj_id: proto_uuid_to_uuid(op_raw.obj_id()),
                                    obj_kind: op_raw.obj_kind(),
                                    path: op_raw.path(), // 0 = no path
                                    payload,
                                };
                                op_vec.push(op);
                            }
                            if op_vec.is_empty() {
                                return Err(AppError::ValidationError(String::from(
                                    "No valid ops found within batch",
                                )));
                            }
                            let batch = IncomingSyncOpBatch {
                                user_id: user_id,
                                socket_id: socket_id,
                                ops: op_vec,
                            };
                            println!("capacity: {}", state.op_batch_processor.tx.capacity());
                            if let Err(err) = state.op_batch_processor.tx.send(batch).await {
                                println!("Error sending to batch processor: {}", err);
                                return Err(AppError::ServerError(String::from(
                                    "Server error when processing",
                                )));
                            };
                            // TODO: Optional acknowledgement (is there a point)
                        }
                        MessageProto::SyncStreamReqProto => {
                            let Some(msg) = msg.message_as_sync_stream_req_proto() else {
                                return Err(AppError::ValidationError(String::from(
                                    "Failed to parse SyncStreamReqProto",
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
                            cur_span.record("user_id", user_id.to_string());
                            let library_id = proto_uuid_to_uuid(msg.library_id());
                            let stream_id = proto_uuid_to_uuid(msg.stream_id());
                            let stream_request = StreamRequest {
                                stream_id,
                                library_id,
                                user_id,
                                socket_id,
                                from_seq: msg.seq(),
                            };
                            if let Err(_) = stream_tx.send(stream_request).await {
                                // TODO: what error could this be
                                return Err(AppError::ServerError(String::from(
                                    "Stream failed to start",
                                )));
                            };
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
        .instrument(
            info_span!("ws_receive", socket_id = %socket_id, msg_type = tracing::field::Empty, user_id = tracing::field::Empty),
        )
        .await;
        // Per message error handler
        if let Err(err) = result {
            handle_websocket_error(&state, socket_id, err).await;
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

pub async fn send_to_client(ws: &WebsocketState, client_id: &Uuid, message: Vec<u8>) {
    // tracing::info!("Sending to client");
    let sender = {
        let mut connections = ws.conn_map.lock().unwrap();
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
