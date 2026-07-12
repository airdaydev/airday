//! Airday FFI — the Rust↔Swift boundary for the Apple clients.
//!
//! Layers 1 & 2 of `spec/swift-ffi-plan.md`: an *offline* capture/read
//! surface only. No sync, no auth, no HTTP — the `SyncEngine` is not
//! exposed. One uniffi object, [`AirdayStore`], owns the sqlite storage,
//! the live `Doc`, and the DEK, mirroring what `airday_core::boot_doc`
//! does for the CLI: boot the doc from persisted ops on open, and after
//! every mutation capture the fresh Loro delta into an encrypted oplog
//! row so a later reopen replays it. Key management (Keychain) is the
//! caller's problem — the DEK crosses the boundary as raw bytes.
//!
//! Everything here is proc-macro / library mode uniffi (no `.udl`):
//! `setup_scaffolding!` plus `#[uniffi::export]` / `#[derive(uniffi::…)]`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use airday_core::{
    ClientOpId, Dek, Doc, DocId, ItemView as CoreItemView, ListView as CoreListView, LocalOpRow,
    LocalStorage, boot_doc,
};
use airday_storage_sqlite::{DbError, SqliteStorage};
use uuid::Uuid;

uniffi::setup_scaffolding!();

/// The single offline doc this store manages. Storage keys everything on
/// `doc_id`; since the offline prototype has no server-assigned account
/// doc, a fixed well-known id keeps open/reopen pointing at the same
/// rows. (Layer 3 sync will replace this with the account's primary doc.)
const FFI_DOC_ID: DocId = DocId(Uuid::from_bytes(*b"airday-ffi-doc!!"));

const DB_FILE: &str = "airday.sqlite";

// ---------- errors ----------

/// Everything that can go wrong across the boundary, flattened to a
/// message per variant so Swift gets a readable `error.localizedDescription`
/// without needing to model core's error trees.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum AirdayError {
    #[error("storage: {message}")]
    Storage { message: String },
    #[error("doc: {message}")]
    Doc { message: String },
    #[error("boot: {message}")]
    Boot { message: String },
    #[error("invalid key: {message}")]
    InvalidKey { message: String },
}

impl From<airday_core::StorageError> for AirdayError {
    fn from(e: airday_core::StorageError) -> Self {
        AirdayError::Storage {
            message: e.to_string(),
        }
    }
}
impl From<airday_core::DocError> for AirdayError {
    fn from(e: airday_core::DocError) -> Self {
        AirdayError::Doc {
            message: e.to_string(),
        }
    }
}
impl From<airday_core::BootError> for AirdayError {
    fn from(e: airday_core::BootError) -> Self {
        AirdayError::Boot {
            message: e.to_string(),
        }
    }
}
impl From<DbError> for AirdayError {
    fn from(e: DbError) -> Self {
        AirdayError::Storage {
            message: e.to_string(),
        }
    }
}
impl From<airday_core::CryptoError> for AirdayError {
    fn from(e: airday_core::CryptoError) -> Self {
        AirdayError::InvalidKey {
            message: e.to_string(),
        }
    }
}

// ---------- flat view records ----------

/// Flat mirror of `airday_core::ItemView` for the FFI boundary. `done` /
/// `binned` are carried as their timestamps (`Some` ≡ set); the Swift
/// side derives the booleans if it wants them.
#[derive(uniffi::Record)]
pub struct ItemView {
    pub id: String,
    pub text: String,
    pub notes: String,
    pub list_id: String,
    pub created_at: i64,
    pub done_at: Option<i64>,
    pub binned_at: Option<i64>,
}

impl From<CoreItemView> for ItemView {
    fn from(v: CoreItemView) -> Self {
        ItemView {
            id: v.id,
            text: v.text,
            notes: v.notes,
            list_id: v.list_id,
            created_at: v.created_at,
            done_at: v.done_at,
            binned_at: v.binned_at,
        }
    }
}

/// Flat mirror of `airday_core::ListView`.
#[derive(uniffi::Record)]
pub struct ListView {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

impl From<CoreListView> for ListView {
    fn from(v: CoreListView) -> Self {
        ListView {
            id: v.id,
            name: v.name,
            created_at: v.created_at,
        }
    }
}

// ---------- the store object ----------

/// Owns storage + doc + DEK for one offline doc.
///
/// The `Doc` is wrapped in a `Mutex`: Loro's `Doc` uses interior
/// mutability but a uniffi object must be `Send + Sync`, and the capture
/// step needs `&mut Doc` (`mark_pushed_at`). The `Mutex` gives both — and
/// serialises the otherwise-single-threaded calls a UI makes.
#[derive(uniffi::Object)]
pub struct AirdayStore {
    doc_id: DocId,
    dek: Dek,
    storage: SqliteStorage,
    doc: Mutex<Doc>,
}

#[uniffi::export]
impl AirdayStore {
    /// Open (creating if needed) `<dir>/airday.sqlite` and boot the doc
    /// from its persisted ops. First open on an empty dir yields a fresh
    /// empty doc. `dek` is the raw 32-byte data-encryption key.
    #[uniffi::constructor]
    pub fn open(dir: String, dek: Vec<u8>) -> Result<Arc<AirdayStore>, AirdayError> {
        let dek = Dek::from_bytes(&dek)?;
        let path = PathBuf::from(dir).join(DB_FILE);
        let storage = SqliteStorage::open(&path)?;
        let (doc, _last_local, _last_acked) = boot_doc(&storage, &dek, FFI_DOC_ID)?;
        Ok(Arc::new(AirdayStore {
            doc_id: FFI_DOC_ID,
            dek,
            storage,
            doc: Mutex::new(doc),
        }))
    }

    pub fn add_item(&self, list_id: String, text: String) -> Result<String, AirdayError> {
        let mut doc = self.doc.lock().expect("doc mutex poisoned");
        let id = doc.add_item(&list_id, &text)?;
        self.persist(&mut doc)?;
        Ok(id)
    }

    pub fn edit_item_text(&self, item_id: String, text: String) -> Result<(), AirdayError> {
        let mut doc = self.doc.lock().expect("doc mutex poisoned");
        doc.edit_item_text(&item_id, &text)?;
        self.persist(&mut doc)
    }

    pub fn set_item_done(&self, item_id: String, done: bool) -> Result<(), AirdayError> {
        let mut doc = self.doc.lock().expect("doc mutex poisoned");
        doc.set_item_done(&item_id, done)?;
        self.persist(&mut doc)
    }

    pub fn set_item_binned(&self, item_id: String, binned: bool) -> Result<(), AirdayError> {
        let mut doc = self.doc.lock().expect("doc mutex poisoned");
        doc.set_item_binned(&item_id, binned)?;
        self.persist(&mut doc)
    }

    pub fn add_list(&self, name: String) -> Result<String, AirdayError> {
        let mut doc = self.doc.lock().expect("doc mutex poisoned");
        let id = doc.add_list(&name)?;
        self.persist(&mut doc)?;
        Ok(id)
    }

    /// Items of `list_id` in resolved order, excluding binned.
    pub fn items_in_list(&self, list_id: String) -> Vec<ItemView> {
        let doc = self.doc.lock().expect("doc mutex poisoned");
        doc.items_in_list(&list_id, false)
            .into_iter()
            .map(Into::into)
            .collect()
    }

    /// All user-created lists (the built-in `inbox`/Inbox list is virtual
    /// and not included — items reference it by the id `"main"`).
    pub fn all_lists(&self) -> Vec<ListView> {
        let doc = self.doc.lock().expect("doc mutex poisoned");
        doc.all_lists().into_iter().map(Into::into).collect()
    }

    /// Pretty-printed JSON dump of the whole doc — a debugging aid.
    pub fn export_json_string(&self) -> String {
        let doc = self.doc.lock().expect("doc mutex poisoned");
        doc.export_json_string()
    }
}

impl AirdayStore {
    /// Capture the doc's pending Loro delta into an encrypted oplog row,
    /// so a later reopen replays it. Mirrors `SyncEngine::capture_local_ops`
    /// minus the wire concerns: seal the delta, append it as a local op,
    /// and advance the capture cursor. Events the mutation queued are
    /// drained and dropped — nothing consumes them offline.
    fn persist(&self, doc: &mut Doc) -> Result<(), AirdayError> {
        if doc.has_pending_ops() {
            // Snapshot the oplog VV before export so a concurrent commit
            // stays pending for the next capture (matches the engine).
            let vv = doc.oplog_vv();
            if let Some(blob) = doc.pending_export(&self.dek)? {
                self.storage.append_local_op(
                    self.doc_id,
                    LocalOpRow {
                        client_op_id: ClientOpId(Uuid::new_v4()),
                        payload: blob,
                    },
                )?;
                doc.mark_pushed_at(vv);
            }
        }
        doc.drain_events();
        Ok(())
    }
}

/// Generate a fresh random 32-byte DEK. Key storage (Keychain in layer 3)
/// is the caller's responsibility; this just mints the bytes.
#[uniffi::export]
pub fn generate_dek() -> Vec<u8> {
    Dek::generate().as_bytes().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip across a close/reopen: mutations captured on the first
    /// handle must replay from disk on a second one, lifecycle states intact.
    /// (`items_in_list` returns every non-binned item, done included — so
    /// the done item stays visible with its `done_at` set, and the binned
    /// item drops out.)
    #[test]
    fn persists_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let dir_str = dir.path().to_str().unwrap().to_string();
        let dek = generate_dek();

        let list_id;
        let done_id;
        let binned_id;
        {
            let store = AirdayStore::open(dir_str.clone(), dek.clone()).unwrap();
            store.add_item("main".into(), "first".into()).unwrap();
            done_id = store.add_item("main".into(), "second".into()).unwrap();
            store.set_item_done(done_id.clone(), true).unwrap();
            binned_id = store.add_item("main".into(), "third".into()).unwrap();
            store.set_item_binned(binned_id.clone(), true).unwrap();
            list_id = store.add_list("Groceries".into()).unwrap();
            store.add_item(list_id.clone(), "milk".into()).unwrap();

            // Live view: "first" + done "second"; binned "third" excluded.
            let main = store.items_in_list("main".into());
            assert_eq!(
                main.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(),
                ["first", "second"]
            );
        } // drop: no explicit close; storage was synchronously durable.

        let store = AirdayStore::open(dir_str, dek).unwrap();
        let main = store.items_in_list("main".into());
        assert_eq!(
            main.iter().map(|i| i.text.as_str()).collect::<Vec<_>>(),
            ["first", "second"],
            "non-binned items (done included) replay from disk"
        );
        let done = main
            .iter()
            .find(|i| i.id == done_id)
            .expect("done item present");
        assert!(done.done_at.is_some(), "done lifecycle survived reopen");

        let groceries = store.items_in_list(list_id);
        assert_eq!(groceries.len(), 1);
        assert_eq!(groceries[0].text, "milk");

        let lists = store.all_lists();
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].name, "Groceries");
    }

    #[test]
    fn generate_dek_is_32_bytes() {
        assert_eq!(generate_dek().len(), 32);
    }
}
