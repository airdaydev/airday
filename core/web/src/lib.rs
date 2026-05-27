//! wasm-bindgen facade over `airday-core`.
//!
//! Surfaces enough of `airday-core` for a JS host to (a) round-trip a
//! `Doc` through a storage adapter and (b) drive the sans-IO
//! `SyncEngine` from a browser-owned `WebSocket`. The
//! password-derivation flow still lives behind `airday-core::crypto::derive_*`
//! and is exposed when the login worker ships.

use wasm_bindgen::prelude::*;

use airday_core::{
    derive_password_master, derive_recovery_master, generate_recovery_code, kek_from_master,
    parse_recovery_code, AppEvent as CoreAppEvent, Dek as CoreDek, Doc as CoreDoc,
    EngineOptions as CoreEngineOptions, Event as CoreEvent, ImportSummary as CoreImportSummary,
    Kek as CoreKek, SyncEngine as CoreSyncEngine, WrappedDek as CoreWrappedDek, AEAD_NONCE_LEN,
};
use airday_protocol::{EncryptedBlob as CoreEncryptedBlob, KdfParams as CoreKdfParams};

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
    /// Fresh doc with built-in state initialised.
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

    #[wasm_bindgen(js_name = addItemAt)]
    pub fn add_item_at(
        &self,
        list_id: &str,
        text: &str,
        target_index: usize,
    ) -> Result<String, JsError> {
        self.inner
            .add_item_at(list_id, text, target_index)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = addItemsAt)]
    pub fn add_items_at(
        &self,
        list_id: &str,
        texts: Vec<String>,
        target_index: usize,
    ) -> Result<Vec<String>, JsError> {
        let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        self.inner
            .add_items_at(list_id, &refs, target_index)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = editItemText)]
    pub fn edit_item_text(&self, item_id: &str, text: &str) -> Result<(), JsError> {
        self.inner.edit_item_text(item_id, text).map_err(js_err)
    }

    #[wasm_bindgen(js_name = editItemNotes)]
    pub fn edit_item_notes(&self, item_id: &str, notes: &str) -> Result<(), JsError> {
        self.inner.edit_item_notes(item_id, notes).map_err(js_err)
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
    pub fn set_item_done(&self, item_id: &str, done: bool) -> Result<(), JsError> {
        self.inner.set_item_done(item_id, done).map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemsDone)]
    pub fn set_items_done(&self, item_ids: Vec<String>, done: bool) -> Result<(), JsError> {
        let refs: Vec<&str> = item_ids.iter().map(|s| s.as_str()).collect();
        self.inner.set_items_done(&refs, done).map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemBinned)]
    pub fn set_item_binned(&self, item_id: &str, binned: bool) -> Result<(), JsError> {
        self.inner.set_item_binned(item_id, binned).map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemsBinned)]
    pub fn set_items_binned(&self, item_ids: Vec<String>, binned: bool) -> Result<(), JsError> {
        let refs: Vec<&str> = item_ids.iter().map(|s| s.as_str()).collect();
        self.inner.set_items_binned(&refs, binned).map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteBinned)]
    pub fn delete_binned(&self, item_id: &str) -> Result<(), JsError> {
        self.inner.delete_binned(item_id).map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteBinnedItems)]
    pub fn delete_binned_items(&self, item_ids: Vec<String>) -> Result<(), JsError> {
        let refs: Vec<&str> = item_ids.iter().map(|s| s.as_str()).collect();
        self.inner.delete_binned_items(&refs).map_err(js_err)
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

    #[wasm_bindgen(js_name = moveList)]
    pub fn move_list(&self, list_id: &str, target_index: usize) -> Result<(), JsError> {
        self.inner.move_list(list_id, target_index).map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteList)]
    pub fn delete_list(&self, list_id: &str) -> Result<(), JsError> {
        self.inner.delete_list(list_id).map_err(js_err)
    }

    #[wasm_bindgen(js_name = setShowListCounts)]
    pub fn set_show_list_counts(&self, show: bool) -> Result<(), JsError> {
        self.inner.set_show_list_counts(show).map_err(js_err)
    }

    #[wasm_bindgen(js_name = setMainName)]
    pub fn set_main_name(&self, name: &str) -> Result<(), JsError> {
        self.inner.set_main_name(name).map_err(js_err)
    }

    // -- reads (return JSON for now; replace with serde-wasm-bindgen
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

    #[wasm_bindgen(js_name = getSettingsJson)]
    pub fn get_settings_json(&self) -> String {
        settings_to_json(&self.inner.get_settings())
    }

    // -- view-id helpers: order-stable id arrays that the JS store
    //    turns into per-view DnD sources --

    /// Ids of `Live` items in `list_id`, in MovableList order.
    #[wasm_bindgen(js_name = liveItemIds)]
    pub fn live_item_ids(&self, list_id: &str) -> Vec<String> {
        self.inner.live_item_ids(list_id)
    }

    /// Ids of all `Done` items, sorted by `done_at` descending.
    #[wasm_bindgen(js_name = doneItemIds)]
    pub fn done_item_ids(&self) -> Vec<String> {
        self.inner.done_item_ids()
    }

    /// Ids of all `Binned` items, sorted by `binned_at` descending.
    #[wasm_bindgen(js_name = binnedItemIds)]
    pub fn binned_item_ids(&self) -> Vec<String> {
        self.inner.binned_item_ids()
    }

    /// Single-item read by id; returns the JSON shape of `itemsInListJson`'s
    /// elements, or `null` if no such item.
    #[wasm_bindgen(js_name = getItemJson)]
    pub fn get_item_json(&self, item_id: &str) -> Option<String> {
        self.inner.get_item(item_id).map(|i| item_to_json(&i))
    }

    /// Single-list-meta read by id; mirrors `getItemJson` for lists.
    #[wasm_bindgen(js_name = getListMetaJson)]
    pub fn get_list_meta_json(&self, list_id: &str) -> Option<String> {
        self.inner.get_list_meta(list_id).map(|l| list_to_json(&l))
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

    // -- WAL primitives --
    //
    // These three methods back the browser local-snapshot + WAL
    // adapter (`spec/idb-wal.md`). The JS host:
    //   1. captures `oplogVvBytes()` after each commit,
    //   2. asks for `exportUpdatesAfter(prev_vv)` to get the delta,
    //   3. encrypts + appends it to IndexedDB,
    //   4. on boot, walks the WAL and feeds each plaintext blob back
    //      via `importWalUpdates`.

    /// Encoded current oplog VersionVector.
    #[wasm_bindgen(js_name = oplogVvBytes)]
    pub fn oplog_vv_bytes(&self) -> Vec<u8> {
        self.inner.oplog_vv_bytes()
    }

    /// Plaintext Loro update bytes for everything committed strictly
    /// after `from_vv`. JS encrypts the result before writing it to
    /// IndexedDB.
    #[wasm_bindgen(js_name = exportUpdatesAfter)]
    pub fn export_updates_after(&self, from_vv: &[u8]) -> Result<Vec<u8>, JsError> {
        self.inner
            .export_updates_after_bytes(from_vv)
            .map_err(js_err)
    }

    /// Plaintext full-state Loro snapshot — for user-driven backup
    /// (`airday.bin`). Loro's `Doc::load`-equivalent reconstructs
    /// identical state from this blob.
    #[wasm_bindgen(js_name = exportSnapshot)]
    pub fn export_snapshot(&self) -> Result<Vec<u8>, JsError> {
        self.inner.export_snapshot_bytes().map_err(js_err)
    }

    /// Pretty-printed JSON dump of every list + item — semantic
    /// (human-readable) export, paired with the binary `exportSnapshot`
    /// CRDT-state export.
    #[wasm_bindgen(js_name = exportJson)]
    pub fn export_json(&self) -> String {
        self.inner.export_json_string()
    }

    /// Additive JSON import — counterpart to `exportJson`. Source lists
    /// become fresh local lists; `main`-bound items land in the local
    /// `main`; existing local content is untouched. Returns a JSON
    /// string of `{ listsAdded, itemsAdded, itemsSkipped }` for UI
    /// summary.
    #[wasm_bindgen(js_name = importJson)]
    pub fn import_json(&self, json: &str) -> Result<String, JsError> {
        let summary = self.inner.import_json_str(json).map_err(js_err)?;
        Ok(summary_to_json(&summary))
    }

    /// Replay one WAL row. Caller has already decrypted; we just feed
    /// it back through the Loro doc tagged so the per-session undo
    /// stack stays clean.
    #[wasm_bindgen(js_name = importWalUpdates)]
    pub fn import_wal_updates(&mut self, plaintext: &[u8]) -> Result<(), JsError> {
        self.inner.import_wal_updates(plaintext).map_err(js_err)
    }

    // -- undo / redo --

    pub fn undo(&self) -> Result<bool, JsError> {
        self.inner.undo().map_err(js_err)
    }

    pub fn redo(&self) -> Result<bool, JsError> {
        self.inner.redo().map_err(js_err)
    }

    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }

    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
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

    /// Duplicate the DEK handle. Needed because
    /// `new SyncEngine(doc, dek, ...)` *consumes* the JS handle, but
    /// we also want the DEK around for encrypt-at-rest via OPFS.
    /// Named `dup` (not `clone`) to dodge the `Clone` trait clash on
    /// the wasm wrapper while still being clear about the intent.
    #[wasm_bindgen(js_name = clone)]
    pub fn dup(&self) -> Dek {
        Dek {
            inner: self.inner.clone(),
        }
    }

    #[wasm_bindgen(js_name = toHex)]
    pub fn to_hex(&self) -> String {
        hex::encode(self.inner.as_bytes())
    }

    /// Encrypt an arbitrary byte buffer with this DEK. Used by the
    /// browser OPFS adapter to encrypt-at-rest local doc snapshots.
    pub fn seal(&self, plaintext: &[u8]) -> Result<EncryptedBlob, JsError> {
        let (ciphertext, nonce) = self.inner.seal(plaintext).map_err(js_err)?;
        Ok(EncryptedBlob {
            inner: CoreEncryptedBlob {
                ciphertext,
                nonce: nonce.to_vec(),
            },
        })
    }

    /// Decrypt a buffer previously produced by `seal`.
    pub fn open(&self, blob: &EncryptedBlob) -> Result<Vec<u8>, JsError> {
        self.inner
            .open(&blob.inner.ciphertext, &blob.inner.nonce)
            .map_err(js_err)
    }
}

// ---------- Auth derivation ----------

/// Result of `deriveLogin`: KEK (in-memory only — pass to `unwrapDek`)
/// and the auth secret to ship to the server. Both are 32-byte arrays.
#[wasm_bindgen]
pub struct DerivedLogin {
    kek: Vec<u8>,
    auth_secret: Vec<u8>,
}

#[wasm_bindgen]
impl DerivedLogin {
    #[wasm_bindgen(getter)]
    pub fn kek(&self) -> Vec<u8> {
        self.kek.clone()
    }

    #[wasm_bindgen(getter, js_name = authSecret)]
    pub fn auth_secret(&self) -> Vec<u8> {
        self.auth_secret.clone()
    }
}

/// Run Argon2id over `password + salt` and split the master into a
/// `kek` (used to unwrap the DEK locally) and `auth_secret` (sent to
/// the server as the login credential). Hundreds of milliseconds —
/// the caller should show a spinner.
///
/// `m_kib`/`t`/`p` are the KdfParams the server returned from
/// `/api/account/prelogin`.
#[wasm_bindgen(js_name = deriveLogin)]
pub fn derive_login(
    password: &str,
    salt: &[u8],
    m_kib: u32,
    t: u32,
    p: u32,
) -> Result<DerivedLogin, JsError> {
    let params = CoreKdfParams { m_kib, t, p };
    let master = derive_password_master(password.as_bytes(), salt, params).map_err(js_err)?;
    let kek = kek_from_master(&master).map_err(js_err)?;
    let auth = master.auth_secret().map_err(js_err)?;
    Ok(DerivedLogin {
        kek: kek.as_bytes().to_vec(),
        auth_secret: auth.as_bytes().to_vec(),
    })
}

/// `wrapDek` output: ciphertext + 24-byte XChaCha20-Poly1305 nonce.
/// Pair with the local `kek` from `deriveLogin` at signup; ship both
/// to `/api/account/signup` as `wrapped_dek` / `wrapped_dek_nonce`.
#[wasm_bindgen]
pub struct WrappedDekJs {
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
}

#[wasm_bindgen]
impl WrappedDekJs {
    #[wasm_bindgen(getter)]
    pub fn ciphertext(&self) -> Vec<u8> {
        self.ciphertext.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn nonce(&self) -> Vec<u8> {
        self.nonce.clone()
    }
}

/// Encrypt a DEK with a KEK. Used at signup and on password change /
/// reset. Browser WebCrypto can't do XChaCha20-Poly1305 so this lives
/// in wasm alongside the rest of the e2ee primitives.
#[wasm_bindgen(js_name = wrapDek)]
pub fn wrap_dek(kek_bytes: &[u8], dek: &Dek) -> Result<WrappedDekJs, JsError> {
    let kek = CoreKek::from_bytes(kek_bytes).map_err(js_err)?;
    let w = kek.wrap(&dek.inner).map_err(js_err)?;
    Ok(WrappedDekJs {
        ciphertext: w.ciphertext,
        nonce: w.nonce.to_vec(),
    })
}

/// Decrypt the DEK shipped from `/api/account/login` using the local
/// `kek` from `deriveLogin`. Wrong password → throws.
#[wasm_bindgen(js_name = unwrapDek)]
pub fn unwrap_dek(
    kek_bytes: &[u8],
    wrapped_ciphertext: &[u8],
    wrapped_nonce: &[u8],
) -> Result<Dek, JsError> {
    let kek = CoreKek::from_bytes(kek_bytes).map_err(js_err)?;
    if wrapped_nonce.len() != AEAD_NONCE_LEN {
        return Err(JsError::new(&format!(
            "wrapped_dek_nonce: expected {AEAD_NONCE_LEN} bytes, got {}",
            wrapped_nonce.len()
        )));
    }
    let mut nonce = [0u8; AEAD_NONCE_LEN];
    nonce.copy_from_slice(wrapped_nonce);
    let wrapped = CoreWrappedDek {
        ciphertext: wrapped_ciphertext.to_vec(),
        nonce,
    };
    let dek = kek.unwrap(&wrapped).map_err(js_err)?;
    Ok(Dek { inner: dek })
}

// ---------- Recovery code ----------

/// Result of `deriveRecovery`: recovery KEK (in-memory only — pass to
/// `unwrapDek` to open the server-held recovery wrap) and the recovery
/// auth secret to send to `/api/account/recover`. Both are 32-byte
/// arrays, mirroring `DerivedLogin`.
#[wasm_bindgen]
pub struct DerivedRecovery {
    recovery_kek: Vec<u8>,
    recovery_auth_secret: Vec<u8>,
}

#[wasm_bindgen]
impl DerivedRecovery {
    #[wasm_bindgen(getter, js_name = recoveryKek)]
    pub fn recovery_kek(&self) -> Vec<u8> {
        self.recovery_kek.clone()
    }

    #[wasm_bindgen(getter, js_name = recoveryAuthSecret)]
    pub fn recovery_auth_secret(&self) -> Vec<u8> {
        self.recovery_auth_secret.clone()
    }
}

/// Fresh 12-word BIP39 phrase. Show once at signup; never persist on
/// the client (the user's the only one who keeps it).
#[wasm_bindgen(js_name = generateRecoveryCode)]
pub fn generate_recovery_code_js() -> Result<String, JsError> {
    Ok(generate_recovery_code()
        .map_err(js_err)?
        .as_str()
        .to_string())
}

/// Validate + normalize a user-typed recovery phrase. Tolerates extra
/// whitespace and case. Throws on invalid words or bad checksum — the
/// UI should surface that as "recovery code not recognized."
#[wasm_bindgen(js_name = parseRecoveryCode)]
pub fn parse_recovery_code_js(input: &str) -> Result<String, JsError> {
    Ok(parse_recovery_code(input)
        .map_err(js_err)?
        .as_str()
        .to_string())
}

/// Argon2id over the recovery phrase + `recovery_salt`, then HKDF into
/// the recovery KEK and recovery auth secret. Mirrors `deriveLogin`'s
/// shape so the host can shovel both into `wrapDek`/`unwrapDek` and the
/// recovery endpoint without thinking about the split.
#[wasm_bindgen(js_name = deriveRecovery)]
pub fn derive_recovery_js(
    recovery_code: &str,
    salt: &[u8],
    m_kib: u32,
    t: u32,
    p: u32,
) -> Result<DerivedRecovery, JsError> {
    let params = CoreKdfParams { m_kib, t, p };
    let master = derive_recovery_master(recovery_code, salt, params).map_err(js_err)?;
    let kek = master.kek().map_err(js_err)?;
    let auth = master.auth_secret().map_err(js_err)?;
    Ok(DerivedRecovery {
        recovery_kek: kek.as_bytes().to_vec(),
        recovery_auth_secret: auth.as_bytes().to_vec(),
    })
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
    /// must not be reused after this call. `last_acked_blob_id` is the
    /// frontier persisted from the previous session (or 0 for a fresh
    /// device).
    #[wasm_bindgen(constructor)]
    pub fn new(
        doc: Doc,
        dek: Dek,
        last_acked_blob_id: u64,
        client_name: String,
        client_version: String,
    ) -> SyncEngine {
        SyncEngine {
            inner: CoreSyncEngine::new(
                doc.inner,
                dek.inner,
                last_acked_blob_id,
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

    /// Drain the next domain-level change event. Pair with `popEvent`
    /// — that one carries protocol/connection events; this one carries
    /// item / list lifecycle deltas the UI store mirrors.
    #[wasm_bindgen(js_name = popAppEvent)]
    pub fn pop_app_event(&self) -> Option<AppEventJs> {
        self.inner.pop_app_event().map(AppEventJs::from)
    }

    /// Synthetic event burst describing current doc state — `ListAdded`
    /// for every list, then `ItemAdded` for every item. Consumers feed
    /// this through the same dispatcher used for live deltas, so a
    /// fresh attach is "current state, then live changes" without a
    /// separate "load initial" path.
    #[wasm_bindgen(js_name = snapshotEvents)]
    pub fn snapshot_events(&self) -> Vec<AppEventJs> {
        self.inner
            .doc()
            .snapshot_events()
            .into_iter()
            .map(AppEventJs::from)
            .collect()
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

    /// Highest server-assigned blob id the engine knows about — caller
    /// persists this as `last_acked_blob_id` between sessions.
    #[wasm_bindgen(js_name = highestSeenBlobId)]
    pub fn highest_seen_blob_id(&self) -> u64 {
        self.inner.highest_seen_blob_id()
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

    // -- WAL passthrough --
    //
    // After each local mutation the browser host captures the oplog
    // VV, asks for the delta since the previous capture, and pushes
    // that into the IndexedDB WAL. Replay (`importWalUpdates`) runs
    // on the bare `Doc` before the engine is constructed, so it lives
    // on `Doc` only.

    #[wasm_bindgen(js_name = oplogVvBytes)]
    pub fn oplog_vv_bytes(&self) -> Vec<u8> {
        self.inner.doc().oplog_vv_bytes()
    }

    #[wasm_bindgen(js_name = exportUpdatesAfter)]
    pub fn export_updates_after(&self, from_vv: &[u8]) -> Result<Vec<u8>, JsError> {
        self.inner
            .doc()
            .export_updates_after_bytes(from_vv)
            .map_err(js_err)
    }

    /// Plaintext full-state Loro snapshot — backs the web client's
    /// "Export → Backup" menu item. Side-effect-free; doesn't touch
    /// `last_pushed_vv` or the WAL frontier.
    #[wasm_bindgen(js_name = exportSnapshot)]
    pub fn export_snapshot(&self) -> Result<Vec<u8>, JsError> {
        self.inner.doc().export_snapshot_bytes().map_err(js_err)
    }

    /// Pretty-printed JSON dump — companion to `exportSnapshot`,
    /// powers the "Export → JSON" menu item.
    #[wasm_bindgen(js_name = exportJson)]
    pub fn export_json(&self) -> String {
        self.inner.doc().export_json_string()
    }

    /// Additive JSON import — counterpart of `exportJson` on the engine
    /// surface. Returns a JSON string of `{ listsAdded, itemsAdded,
    /// itemsSkipped }`. Doesn't push or flush — caller's normal
    /// post-mutation flow (WAL append, sync push) handles the new ops
    /// like any other local commit.
    #[wasm_bindgen(js_name = importJson)]
    pub fn import_json(&self, json: &str) -> Result<String, JsError> {
        let summary = self.inner.doc().import_json_str(json).map_err(js_err)?;
        Ok(summary_to_json(&summary))
    }

    // -- mutations: items --

    #[wasm_bindgen(js_name = addItem)]
    pub fn add_item(&self, list_id: &str, text: &str) -> Result<String, JsError> {
        self.inner.doc().add_item(list_id, text).map_err(js_err)
    }

    #[wasm_bindgen(js_name = addItemAt)]
    pub fn add_item_at(
        &self,
        list_id: &str,
        text: &str,
        target_index: usize,
    ) -> Result<String, JsError> {
        self.inner
            .doc()
            .add_item_at(list_id, text, target_index)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = addItemsAt)]
    pub fn add_items_at(
        &self,
        list_id: &str,
        texts: Vec<String>,
        target_index: usize,
    ) -> Result<Vec<String>, JsError> {
        let refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        self.inner
            .doc()
            .add_items_at(list_id, &refs, target_index)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = editItemText)]
    pub fn edit_item_text(&self, item_id: &str, text: &str) -> Result<(), JsError> {
        self.inner
            .doc()
            .edit_item_text(item_id, text)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = editItemNotes)]
    pub fn edit_item_notes(&self, item_id: &str, notes: &str) -> Result<(), JsError> {
        self.inner
            .doc()
            .edit_item_notes(item_id, notes)
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
    pub fn set_item_done(&self, item_id: &str, done: bool) -> Result<(), JsError> {
        self.inner
            .doc()
            .set_item_done(item_id, done)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemsDone)]
    pub fn set_items_done(&self, item_ids: Vec<String>, done: bool) -> Result<(), JsError> {
        let refs: Vec<&str> = item_ids.iter().map(|s| s.as_str()).collect();
        self.inner.doc().set_items_done(&refs, done).map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemBinned)]
    pub fn set_item_binned(&self, item_id: &str, binned: bool) -> Result<(), JsError> {
        self.inner
            .doc()
            .set_item_binned(item_id, binned)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = setItemsBinned)]
    pub fn set_items_binned(&self, item_ids: Vec<String>, binned: bool) -> Result<(), JsError> {
        let refs: Vec<&str> = item_ids.iter().map(|s| s.as_str()).collect();
        self.inner
            .doc()
            .set_items_binned(&refs, binned)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteBinned)]
    pub fn delete_binned(&self, item_id: &str) -> Result<(), JsError> {
        self.inner.doc().delete_binned(item_id).map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteBinnedItems)]
    pub fn delete_binned_items(&self, item_ids: Vec<String>) -> Result<(), JsError> {
        let refs: Vec<&str> = item_ids.iter().map(|s| s.as_str()).collect();
        self.inner.doc().delete_binned_items(&refs).map_err(js_err)
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

    #[wasm_bindgen(js_name = moveList)]
    pub fn move_list(&self, list_id: &str, target_index: usize) -> Result<(), JsError> {
        self.inner
            .doc()
            .move_list(list_id, target_index)
            .map_err(js_err)
    }

    #[wasm_bindgen(js_name = deleteList)]
    pub fn delete_list(&self, list_id: &str) -> Result<(), JsError> {
        self.inner.doc().delete_list(list_id).map_err(js_err)
    }

    #[wasm_bindgen(js_name = setShowListCounts)]
    pub fn set_show_list_counts(&self, show: bool) -> Result<(), JsError> {
        self.inner.doc().set_show_list_counts(show).map_err(js_err)
    }

    #[wasm_bindgen(js_name = setMainName)]
    pub fn set_main_name(&self, name: &str) -> Result<(), JsError> {
        self.inner.doc().set_main_name(name).map_err(js_err)
    }

    // -- undo / redo --

    pub fn undo(&self) -> Result<bool, JsError> {
        self.inner.doc().undo().map_err(js_err)
    }

    pub fn redo(&self) -> Result<bool, JsError> {
        self.inner.doc().redo().map_err(js_err)
    }

    #[wasm_bindgen(js_name = canUndo)]
    pub fn can_undo(&self) -> bool {
        self.inner.doc().can_undo()
    }

    #[wasm_bindgen(js_name = canRedo)]
    pub fn can_redo(&self) -> bool {
        self.inner.doc().can_redo()
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

    #[wasm_bindgen(js_name = getSettingsJson)]
    pub fn get_settings_json(&self) -> String {
        settings_to_json(&self.inner.doc().get_settings())
    }

    #[wasm_bindgen(js_name = liveItemIds)]
    pub fn live_item_ids(&self, list_id: &str) -> Vec<String> {
        self.inner.doc().live_item_ids(list_id)
    }

    #[wasm_bindgen(js_name = doneItemIds)]
    pub fn done_item_ids(&self) -> Vec<String> {
        self.inner.doc().done_item_ids()
    }

    #[wasm_bindgen(js_name = binnedItemIds)]
    pub fn binned_item_ids(&self) -> Vec<String> {
        self.inner.doc().binned_item_ids()
    }

    #[wasm_bindgen(js_name = getItemJson)]
    pub fn get_item_json(&self, item_id: &str) -> Option<String> {
        self.inner.doc().get_item(item_id).map(|i| item_to_json(&i))
    }

    #[wasm_bindgen(js_name = getListMetaJson)]
    pub fn get_list_meta_json(&self, list_id: &str) -> Option<String> {
        self.inner
            .doc()
            .get_list_meta(list_id)
            .map(|l| list_to_json(&l))
    }
}

// ---------- EngineEvent ----------

/// Flat JS-friendly view of `airday_core::Event`. The host switches on
/// `kind` and reads the payload-specific getter — exactly one of
/// `online`, `blobId`, `message` will be set per event (or none, for
/// payload-less variants).
#[wasm_bindgen]
pub struct EngineEvent {
    kind: &'static str,
    online: Option<bool>,
    blob_id: Option<u64>,
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

    #[wasm_bindgen(getter, js_name = blobId)]
    pub fn blob_id(&self) -> Option<u64> {
        self.blob_id
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
                blob_id: None,
                message: None,
            },
            CoreEvent::PulledInitial => EngineEvent {
                kind: "pulledInitial",
                online: None,
                blob_id: None,
                message: None,
            },
            CoreEvent::Pushed => EngineEvent {
                kind: "pushed",
                online: None,
                blob_id: None,
                message: None,
            },
            CoreEvent::FrontierAdvanced { blob_id } => EngineEvent {
                kind: "frontierAdvanced",
                online: None,
                blob_id: Some(blob_id),
                message: None,
            },
            CoreEvent::Error(message) => EngineEvent {
                kind: "error",
                online: None,
                blob_id: None,
                message: Some(message),
            },
        }
    }
}

// ---------- AppEventJs ----------

/// Flat JS-friendly view of `airday_core::AppEvent`. The host switches
/// on `kind` and reads only the fields documented for that variant —
/// every other getter returns `undefined`.
///
/// Variant → fields:
/// - `itemAdded` — id, listId, text, notes, createdAt, doneAt?, binnedAt?, index
/// - `itemRemoved` — id
/// - `itemMoved` — id, index
/// - `itemTextChanged` — id, text
/// - `itemNotesChanged` — id, notes
/// - `itemStatusChanged` — id, doneAt?, binnedAt?
/// - `itemListChanged` — id, listId
/// - `listAdded` — id, name, createdAt, index
/// - `listRemoved` — id
/// - `listMoved` — id, index
/// - `listRenamed` — id, name
/// - `settingsChanged` — showListCounts, mainName?
#[wasm_bindgen]
pub struct AppEventJs {
    kind: &'static str,
    id: String,
    list_id: Option<String>,
    text: Option<String>,
    notes: Option<String>,
    name: Option<String>,
    created_at: Option<i64>,
    done_at: Option<i64>,
    binned_at: Option<i64>,
    show_list_counts: Option<bool>,
    /// Settings: `Some(name)` when the user has overridden Queue's
    /// label; `None` (or absent on non-`settingsChanged` events) means
    /// fall back to the localized built-in label.
    main_name: Option<String>,
    index: Option<usize>,
}

#[wasm_bindgen]
impl AppEventJs {
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.to_string()
    }
    #[wasm_bindgen(getter)]
    pub fn id(&self) -> String {
        self.id.clone()
    }
    #[wasm_bindgen(getter, js_name = listId)]
    pub fn list_id(&self) -> Option<String> {
        self.list_id.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn text(&self) -> Option<String> {
        self.text.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn notes(&self) -> Option<String> {
        self.notes.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn name(&self) -> Option<String> {
        self.name.clone()
    }
    #[wasm_bindgen(getter, js_name = createdAt)]
    pub fn created_at(&self) -> Option<i64> {
        self.created_at
    }
    #[wasm_bindgen(getter, js_name = doneAt)]
    pub fn done_at(&self) -> Option<i64> {
        self.done_at
    }
    #[wasm_bindgen(getter, js_name = binnedAt)]
    pub fn binned_at(&self) -> Option<i64> {
        self.binned_at
    }
    #[wasm_bindgen(getter)]
    pub fn index(&self) -> Option<usize> {
        self.index
    }
    #[wasm_bindgen(getter, js_name = showListCounts)]
    pub fn show_list_counts(&self) -> Option<bool> {
        self.show_list_counts
    }
    #[wasm_bindgen(getter, js_name = mainName)]
    pub fn main_name(&self) -> Option<String> {
        self.main_name.clone()
    }
}

impl From<CoreAppEvent> for AppEventJs {
    fn from(e: CoreAppEvent) -> Self {
        let blank = AppEventJs {
            kind: "",
            id: String::new(),
            list_id: None,
            text: None,
            notes: None,
            name: None,
            created_at: None,
            done_at: None,
            binned_at: None,
            show_list_counts: None,
            main_name: None,
            index: None,
        };
        match e {
            CoreAppEvent::ItemAdded {
                id,
                list_id,
                text,
                notes,
                created_at,
                done_at,
                binned_at,
                index,
            } => AppEventJs {
                kind: "itemAdded",
                id,
                list_id: Some(list_id),
                text: Some(text),
                notes: Some(notes),
                created_at: Some(created_at),
                done_at,
                binned_at,
                index: Some(index),
                ..blank
            },
            CoreAppEvent::ItemRemoved { id } => AppEventJs {
                kind: "itemRemoved",
                id,
                ..blank
            },
            CoreAppEvent::ItemMoved { id, index } => AppEventJs {
                kind: "itemMoved",
                id,
                index: Some(index),
                ..blank
            },
            CoreAppEvent::ItemTextChanged { id, text } => AppEventJs {
                kind: "itemTextChanged",
                id,
                text: Some(text),
                ..blank
            },
            CoreAppEvent::ItemNotesChanged { id, notes } => AppEventJs {
                kind: "itemNotesChanged",
                id,
                notes: Some(notes),
                ..blank
            },
            CoreAppEvent::ItemStatusChanged {
                id,
                done_at,
                binned_at,
            } => AppEventJs {
                kind: "itemStatusChanged",
                id,
                done_at,
                binned_at,
                ..blank
            },
            CoreAppEvent::ItemListChanged { id, list_id } => AppEventJs {
                kind: "itemListChanged",
                id,
                list_id: Some(list_id),
                ..blank
            },
            CoreAppEvent::ListAdded {
                id,
                name,
                created_at,
                index,
            } => AppEventJs {
                kind: "listAdded",
                id,
                name: Some(name),
                created_at: Some(created_at),
                index: Some(index),
                ..blank
            },
            CoreAppEvent::ListRemoved { id } => AppEventJs {
                kind: "listRemoved",
                id,
                ..blank
            },
            CoreAppEvent::ListMoved { id, index } => AppEventJs {
                kind: "listMoved",
                id,
                index: Some(index),
                ..blank
            },
            CoreAppEvent::ListRenamed { id, name } => AppEventJs {
                kind: "listRenamed",
                id,
                name: Some(name),
                ..blank
            },
            CoreAppEvent::SettingsChanged {
                show_list_counts,
                main_name,
            } => AppEventJs {
                kind: "settingsChanged",
                show_list_counts: Some(show_list_counts),
                main_name,
                ..blank
            },
        }
    }
}

// ---------- private helpers ----------

fn list_to_json(l: &airday_core::ListView) -> String {
    format!(
        "{{\"id\":{},\"name\":{},\"createdAt\":{}}}",
        json_string(&l.id),
        json_string(&l.name),
        l.created_at,
    )
}

fn settings_to_json(s: &airday_core::SettingsView) -> String {
    let mut out = format!("{{\"showListCounts\":{}", s.show_list_counts);
    if let Some(n) = &s.main_name {
        out.push_str(",\"mainName\":");
        out.push_str(&json_string(n));
    }
    out.push('}');
    out
}

fn lists_to_json(lists: &[airday_core::ListView]) -> String {
    let mut s = String::from("[");
    for (i, l) in lists.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&list_to_json(l));
    }
    s.push(']');
    s
}

fn item_to_json(it: &airday_core::ItemView) -> String {
    let mut s = format!(
        "{{\"id\":{},\"text\":{},\"notes\":{},\"listId\":{},\"createdAt\":{}",
        json_string(&it.id),
        json_string(&it.text),
        json_string(&it.notes),
        json_string(&it.list_id),
        it.created_at,
    );
    if let Some(t) = it.done_at {
        s.push_str(&format!(",\"doneAt\":{t}"));
    }
    if let Some(t) = it.binned_at {
        s.push_str(&format!(",\"binnedAt\":{t}"));
    }
    s.push('}');
    s
}

fn items_to_json(items: &[airday_core::ItemView]) -> String {
    let mut s = String::from("[");
    for (i, it) in items.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&item_to_json(it));
    }
    s.push(']');
    s
}

fn summary_to_json(s: &CoreImportSummary) -> String {
    format!(
        "{{\"listsAdded\":{},\"itemsAdded\":{},\"itemsSkipped\":{}}}",
        s.lists_added, s.items_added, s.items_skipped,
    )
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
