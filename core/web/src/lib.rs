//! wasm-bindgen facade over `airday-core`.
//!
//! Slice 1 surface: just enough to round-trip a `Doc` through a JS-side
//! storage adapter and prove the wasm build path works end-to-end.
//! Sync state machine and password-derivation flow are deliberately out
//! of scope for this slice — they live behind the `airday-core::Session`
//! and `airday-core::crypto::derive_*` boundaries respectively, and need
//! a transport-layer decision before they cross into wasm.

use wasm_bindgen::prelude::*;

use airday_core::{Dek as CoreDek, Doc as CoreDoc};
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
        let mut s = String::from("[");
        for (i, l) in self.inner.all_lists().iter().enumerate() {
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

// ---------- private helpers ----------

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
