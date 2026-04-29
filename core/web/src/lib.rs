//! wasm-bindgen facade over `airday-core`.
//!
//! Surfaces enough of `airday-core` for a JS host to (a) round-trip a
//! `Doc` through a storage adapter (slice 1) and (b) drive the sans-IO
//! `SyncEngine` from a browser-owned `WebSocket` (slice 3). The
//! password-derivation flow still lives behind `airday-core::crypto::derive_*`
//! and is exposed when the login worker ships.

use wasm_bindgen::prelude::*;

use airday_core::{
    Dek as CoreDek, Doc as CoreDoc, EngineOptions as CoreEngineOptions, Event as CoreEvent,
    SyncEngine as CoreSyncEngine,
};
use airday_protocol::EncryptedBlob as CoreEncryptedBlob;

/// Install the panic hook so Rust panics surface as readable JS errors
/// in the console rather than `RuntimeError: unreachable`.
#[wasm_bindgen(start)]
pub fn _start() {
    console_error_panic_hook::set_once();
}

fn js_err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

// ---------- Doc ----------

#[wasm_bindgen]
pub struct Doc {
    inner: CoreDoc,
}

#[wasm_bindgen]
impl Doc {
    /// Fresh doc with built-in lists seeded.
    #[wasm_bindgen(js_name = create)]
    pub fn create() -> Result<Doc, JsError> {
        Ok(Doc {
            inner: CoreDoc::new().map_err(js_err)?,
        })
    }

    /// Empty doc — used when bootstrapping a second device that will
    /// receive the seed via the op stream.
    #[wasm_bindgen(js_name = empty)]
    pub fn empty() -> Doc {
        Doc {
            inner: CoreDoc::empty(),
        }
    }

    /// Decode a doc previously written via [`Doc::save`].
    #[wasm_bindgen(js_name = load)]
    pub fn load(bytes: &[u8]) -> Result<Doc, JsError> {
        Ok(Doc {
            inner: CoreDoc::load(bytes).map_err(js_err)?,
        })
    }

    /// Snapshot + last-pushed VV envelope. Persist this verbatim.
    pub fn save(&self) -> Result<Vec<u8>, JsError> {
        self.inner.save().map_err(js_err)
    }

    /// 32-byte logical-state hash. Stable across replicas at logical
    /// equality. Used in tests to assert convergence.
    pub fn fingerprint(&self) -> Vec<u8> {
        self.inner.fingerprint().to_vec()
    }

    // -- mutations: items --

    #[wasm_bindgen(js_name = addItem)]
    pub fn add_item(&self, list_id: &str, text: &str) -> Result<String, JsError> {
        self.inner.add_item(list_id, text).map_err(js_err)
    }

    #[wasm_bindgen(js_name = editItemText)]
    pub fn edit_item_text(&self, item_id: &str, text: &str) -> Result<(), JsError> {
        self.inner.edit_item_text(item_id, text).map_err(js_err)
    }

    #[wasm_bindgen(js_name = moveItem)]
    pub fn move_item(
        &self,
        item_id: &str,
        target_list_id: &str,
        target_index: usize,
    ) -> Result<(), JsError> {
        self.inner
            .move_item(item_id, target_list_id, target_index)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemDone)]
    pub fn set_item_done(&self, item_id: &str) -> Result<(), JsError> {
        self.inner
            .set_item_status(item_id, airday_core::Status::Done)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemLive)]
    pub fn set_item_live(&self, item_id: &str) -> Result<(), JsError> {
        self.inner
            .set_item_status(item_id, airday_core::Status::Live)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = binItem)]
    pub fn bin_item(&self, item_id: &str) -> Result<(), JsError> {
        self.inner
            .set_item_status(item_id, airday_core::Status::Binned)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteBinned)]
    pub fn delete_binned(&self, item_id: &str) -> Result<(), JsError> {
        self.inner.delete_binned(item_id).map_err(js_err)
    }

    #[wasm_bindgen(js_name = emptyBin)]
    pub fn empty_bin(&self) -> Result<usize, JsError> {
        self.inner.empty_bin().map_err(js_err)
    }

    // -- mutations: lists --

    #[wasm_bindgen(js_name = addList)]
    pub fn add_list(&self, name: &str) -> Result<String, JsError> {
        self.inner.add_list(name).map_err(js_err)
    }

    #[wasm_bindgen(js_name = renameList)]
    pub fn rename_list(&self, list_id: &str, name: &str) -> Result<(), JsError> {
        self.inner.rename_list(list_id, name).map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteList)]
    pub fn delete_list(&self, list_id: &str) -> Result<(), JsError> {
        self.inner.delete_list(list_id).map_err(js_err)
    }

    // -- reads (return JSON for slice 1; replace with serde-wasm-bindgen
    //    structured returns once a real consumer needs them) --

    #[wasm_bindgen(js_name = itemsInListJson)]
    pub fn items_in_list_json(&self, list_id: &str, include_binned: bool) -> String {
        let items = self.inner.items_in_list(list_id, include_binned);
        items_to_json(&items)
    }

    #[wasm_bindgen(js_name = binnedItemsJson)]
    pub fn binned_items_json(&self) -> String {
        items_to_json(&self.inner.binned_items())
    }

    #[wasm_bindgen(js_name = allListsJson)]
    pub fn all_lists_json(&self) -> String {
        lists_to_json(&self.inner.all_lists())
    }

    // -- op stream --

    #[wasm_bindgen(js_name = hasPendingOps)]
    pub fn has_pending_ops(&self) -> bool {
        self.inner.has_pending_ops()
    }

    /// Encrypted blob containing every commit since `last_pushed_vv`.
    /// Returns `null` if there's nothing new.
    #[wasm_bindgen(js_name = pendingExport)]
    pub fn pending_export(&self, dek: &Dek) -> Result<Option<EncryptedBlob>, JsError> {
        Ok(self
            .inner
            .pending_export(&dek.inner)
            .map_err(js_err)?
            .map(|b| EncryptedBlob { inner: b }))
    }

    /// Mark every committed op as shipped. Call after `pending_export`'s
    /// blob has been ack'd by the server.
    #[wasm_bindgen(js_name = markPushed)]
    pub fn mark_pushed(&mut self) {
        self.inner.mark_pushed();
    }

    /// Decrypt and apply a peer op blob.
    #[wasm_bindgen(js_name = applyRemote)]
    pub fn apply_remote(&mut self, dek: &Dek, blob: &EncryptedBlob) -> Result<(), JsError> {
        self.inner
            .apply_remote(&dek.inner, &blob.inner)
            .map_err(js_err)
    }
}

// ---------- Dek ----------

#[wasm_bindgen]
pub struct Dek {
    inner: CoreDek,
}

#[wasm_bindgen]
impl Dek {
    /// Fresh random DEK. Called once at signup.
    pub fn generate() -> Dek {
        Dek {
            inner: CoreDek::generate(),
        }
    }

    #[wasm_bindgen(js_name = fromHex)]
    pub fn from_hex(hex: &str) -> Result<Dek, JsError> {
        let bytes = hex::decode(hex).map_err(js_err)?;
        Ok(Dek {
            inner: CoreDek::from_bytes(&bytes).map_err(js_err)?,
        })
    }

    #[wasm_bindgen(js_name = toHex)]
    pub fn to_hex(&self) -> String {
        hex::encode(self.inner.as_bytes())
    }
}

// ---------- EncryptedBlob ----------

#[wasm_bindgen]
pub struct EncryptedBlob {
    inner: CoreEncryptedBlob,
}

#[wasm_bindgen]
impl EncryptedBlob {
    #[wasm_bindgen(constructor)]
    pub fn new(nonce: Vec<u8>, ciphertext: Vec<u8>) -> EncryptedBlob {
        EncryptedBlob {
            inner: CoreEncryptedBlob { nonce, ciphertext },
        }
    }

    #[wasm_bindgen(getter)]
    pub fn nonce(&self) -> Vec<u8> {
        self.inner.nonce.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn ciphertext(&self) -> Vec<u8> {
        self.inner.ciphertext.clone()
    }
}

// ---------- SyncEngine ----------

#[wasm_bindgen]
pub struct SyncEngine {
    inner: CoreSyncEngine,
}

#[wasm_bindgen]
impl SyncEngine {
    /// Build a new engine. Consumes `doc` and `dek` — the JS handles
    /// must not be reused after this call. `last_acked_op_id` is the
    /// frontier persisted from the previous session (or 0 for a fresh
    /// device).
    #[wasm_bindgen(constructor)]
    pub fn new(
        doc: Doc,
        dek: Dek,
        last_acked_op_id: u64,
        client_name: String,
        client_version: String,
    ) -> SyncEngine {
        SyncEngine {
            inner: CoreSyncEngine::new(
                doc.inner,
                dek.inner,
                last_acked_op_id,
                CoreEngineOptions {
                    client_name,
                    client_version,
                },
            ),
        }
    }

    // -- transport callbacks --

    /// Caller's WebSocket has opened. Engine queues the `Hello` frame.
    #[wasm_bindgen(js_name = handleConnected)]
    pub fn handle_connected(&mut self) {
        self.inner.handle_connected();
    }

    /// Caller's WebSocket dropped. Engine returns to `Disconnected` and
    /// clears the outbox; reconnect re-derives any pending frames.
    #[wasm_bindgen(js_name = handleDisconnected)]
    pub fn handle_disconnected(&mut self) {
        self.inner.handle_disconnected();
    }

    /// Caller-driven timeout (e.g. handshake watchdog). Only escalates
    /// when in `Hello`; no-op elsewhere.
    #[wasm_bindgen(js_name = handleTimeout)]
    pub fn handle_timeout(&mut self) {
        self.inner.handle_timeout();
    }

    /// Hand one binary WebSocket frame to the engine.
    #[wasm_bindgen(js_name = handleServerBytes)]
    pub fn handle_server_bytes(&mut self, bytes: &[u8]) {
        self.inner.handle_server_bytes(bytes);
    }

    // -- caller drives --

    /// Signal that the user just committed local mutations. Triggers a
    /// push when idle; queues the intent otherwise.
    pub fn flush(&mut self) {
        self.inner.flush();
    }

    /// Drain the next frame to ship to the server. Returns `undefined`
    /// when the outbox is empty.
    #[wasm_bindgen(js_name = popOutbox)]
    pub fn pop_outbox(&mut self) -> Option<Vec<u8>> {
        self.inner.pop_outbox()
    }

    /// Drain the next engine event. Returns `undefined` when the queue
    /// is empty.
    #[wasm_bindgen(js_name = popEvent)]
    pub fn pop_event(&mut self) -> Option<EngineEvent> {
        self.inner.pop_event().map(EngineEvent::from)
    }

    // -- introspection --

    #[wasm_bindgen(js_name = isOnline)]
    pub fn is_online(&self) -> bool {
        self.inner.is_online()
    }

    #[wasm_bindgen(js_name = isIdle)]
    pub fn is_idle(&self) -> bool {
        self.inner.is_idle()
    }

    /// Highest server-assigned op id the engine knows about — caller
    /// persists this as `last_acked_op_id` between sessions.
    #[wasm_bindgen(js_name = highestSeenOpId)]
    pub fn highest_seen_op_id(&self) -> u64 {
        self.inner.highest_seen_op_id()
    }

    // -- doc passthrough --
    //
    // Engine owns the `Doc`, but JS still needs to read it (render UI)
    // and mutate it (user actions). Loro mutations take `&self` thanks
    // to interior mutability, so the wrapper can share the engine's
    // borrow without `&mut self` ceremony.

    /// Snapshot envelope to persist (loro snapshot + last-pushed VV).
    pub fn save(&self) -> Result<Vec<u8>, JsError> {
        self.inner.doc().save().map_err(js_err)
    }

    /// 32-byte logical-state hash. Stable across replicas.
    pub fn fingerprint(&self) -> Vec<u8> {
        self.inner.doc().fingerprint().to_vec()
    }

    #[wasm_bindgen(js_name = hasPendingOps)]
    pub fn has_pending_ops(&self) -> bool {
        self.inner.doc().has_pending_ops()
    }

    // -- mutations: items --

    #[wasm_bindgen(js_name = addItem)]
    pub fn add_item(&self, list_id: &str, text: &str) -> Result<String, JsError> {
        self.inner.doc().add_item(list_id, text).map_err(js_err)
    }

    #[wasm_bindgen(js_name = editItemText)]
    pub fn edit_item_text(&self, item_id: &str, text: &str) -> Result<(), JsError> {
        self.inner
            .doc()
            .edit_item_text(item_id, text)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = moveItem)]
    pub fn move_item(
        &self,
        item_id: &str,
        target_list_id: &str,
        target_index: usize,
    ) -> Result<(), JsError> {
        self.inner
            .doc()
            .move_item(item_id, target_list_id, target_index)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemDone)]
    pub fn set_item_done(&self, item_id: &str) -> Result<(), JsError> {
        self.inner
            .doc()
            .set_item_status(item_id, airday_core::Status::Done)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemLive)]
    pub fn set_item_live(&self, item_id: &str) -> Result<(), JsError> {
        self.inner
            .doc()
            .set_item_status(item_id, airday_core::Status::Live)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = binItem)]
    pub fn bin_item(&self, item_id: &str) -> Result<(), JsError> {
        self.inner
            .doc()
            .set_item_status(item_id, airday_core::Status::Binned)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteBinned)]
    pub fn delete_binned(&self, item_id: &str) -> Result<(), JsError> {
        self.inner.doc().delete_binned(item_id).map_err(js_err)
    }

    #[wasm_bindgen(js_name = emptyBin)]
    pub fn empty_bin(&self) -> Result<usize, JsError> {
        self.inner.doc().empty_bin().map_err(js_err)
    }

    // -- mutations: lists --

    #[wasm_bindgen(js_name = addList)]
    pub fn add_list(&self, name: &str) -> Result<String, JsError> {
        self.inner.doc().add_list(name).map_err(js_err)
    }

    #[wasm_bindgen(js_name = renameList)]
    pub fn rename_list(&self, list_id: &str, name: &str) -> Result<(), JsError> {
        self.inner.doc().rename_list(list_id, name).map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteList)]
    pub fn delete_list(&self, list_id: &str) -> Result<(), JsError> {
        self.inner.doc().delete_list(list_id).map_err(js_err)
    }

    // -- reads --

    #[wasm_bindgen(js_name = itemsInListJson)]
    pub fn items_in_list_json(&self, list_id: &str, include_binned: bool) -> String {
        items_to_json(&self.inner.doc().items_in_list(list_id, include_binned))
    }

    #[wasm_bindgen(js_name = binnedItemsJson)]
    pub fn binned_items_json(&self) -> String {
        items_to_json(&self.inner.doc().binned_items())
    }

    #[wasm_bindgen(js_name = allListsJson)]
    pub fn all_lists_json(&self) -> String {
        lists_to_json(&self.inner.doc().all_lists())
    }
}

// ---------- EngineEvent ----------

/// Flat JS-friendly view of `airday_core::Event`. The host switches on
/// `kind` and reads the payload-specific getter — exactly one of
/// `online`, `opId`, `message` will be set per event (or none, for
/// payload-less variants).
#[wasm_bindgen]
pub struct EngineEvent {
    kind: &'static str,
    online: Option<bool>,
    op_id: Option<u64>,
    message: Option<String>,
}

#[wasm_bindgen]
impl EngineEvent {
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.to_string()
    }

    #[wasm_bindgen(getter)]
    pub fn online(&self) -> Option<bool> {
        self.online
    }

    #[wasm_bindgen(getter, js_name = opId)]
    pub fn op_id(&self) -> Option<u64> {
        self.op_id
    }

    #[wasm_bindgen(getter)]
    pub fn message(&self) -> Option<String> {
        self.message.clone()
    }
}

impl From<CoreEvent> for EngineEvent {
    fn from(e: CoreEvent) -> Self {
        match e {
            CoreEvent::ConnStateChanged { online } => EngineEvent {
                kind: "connStateChanged",
                online: Some(online),
                op_id: None,
                message: None,
            },
            CoreEvent::PulledInitial => EngineEvent {
                kind: "pulledInitial",
                online: None,
                op_id: None,
                message: None,
            },
            CoreEvent::OpsApplied => EngineEvent {
                kind: "opsApplied",
                online: None,
                op_id: None,
                message: None,
            },
            CoreEvent::Pushed => EngineEvent {
                kind: "pushed",
                online: None,
                op_id: None,
                message: None,
            },
            CoreEvent::FrontierAdvanced { id } => EngineEvent {
                kind: "frontierAdvanced",
                online: None,
                op_id: Some(id),
                message: None,
            },
            CoreEvent::Error(message) => EngineEvent {
                kind: "error",
                online: None,
                op_id: None,
                message: Some(message),
            },
        }
    }
}

// ---------- private helpers ----------

fn lists_to_json(lists: &[airday_core::ListView]) -> String {
    let mut s = String::from("[");
    for (i, l) in lists.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!(
            "{{\"id\":{},\"name\":{},\"createdAt\":{}}}",
            json_string(&l.id),
            json_string(&l.name),
            l.created_at
        ));
    }
    s.push(']');
    s
}

fn items_to_json(items: &[airday_core::ItemView]) -> String {
    let mut s = String::from("[");
    for (i, it) in items.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!(
            "{{\"id\":{},\"text\":{},\"listId\":{},\"status\":{},\"createdAt\":{}",
            json_string(&it.id),
            json_string(&it.text),
            json_string(&it.list_id),
            json_string(status_str(it.status)),
            it.created_at,
        ));
        if let Some(t) = it.done_at {
            s.push_str(&format!(",\"doneAt\":{t}"));
        }
        if let Some(t) = it.binned_at {
            s.push_str(&format!(",\"binnedAt\":{t}"));
        }
        s.push('}');
    }
    s.push(']');
    s
}

fn status_str(s: airday_core::Status) -> &'static str {
    match s {
        airday_core::Status::Live => "live",
        airday_core::Status::Done => "done",
        airday_core::Status::Binned => "binned",
    }
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
