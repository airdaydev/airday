//! Loro CRDT layer: typed mutations, persistence, op-stream framing,
//! and a deterministic logical-state fingerprint.
//!
//! Layout matches `spec/data-model.md`:
//! - root container `items` (`LoroMovableList`) — each entry is a
//!   `LoroMap` with `id`, `text`, `list_id`, `created_at`, optional
//!   `done_at`, optional `binned_at`. `done` and `binned` are
//!   orthogonal: an item can be both. Presence of the timestamp is
//!   the flag — there's no separate boolean.
//! - root container `lists` (`LoroMovableList`) — each entry is a
//!   `LoroMap` with `id`, `name`, `created_at`.
//!
//! The bin is *not* a list — binned items keep their `list_id`. One
//! well-known list id is *reserved*: [`LIST_MAIN`].
//! It has **no MovableList entry** — items reference it by string id
//! and clients render it with a hardcoded label ("Home"). A future
//! meta-CRDT will hold things like the user's chosen label for it; for
//! now main is non-renamable and non-movable.
//!
//! The struct holds a `last_pushed_vv` so we can hand the sync engine
//! "what's new since the last server interaction" as a single sealed
//! blob without re-shipping ops we already saw.

#[cfg(not(target_arch = "wasm32"))]
use std::time::{SystemTime, UNIX_EPOCH};

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;

use loro::{
    Container, ExportMode, LoroDoc, LoroMap, LoroMovableList, UndoManager, ValueOrContainer,
    VersionVector,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::crypto::{Dek, AEAD_NONCE_LEN};
use crate::events::AppEvent;
use airday_protocol::EncryptedBlob;

pub const LIST_MAIN: &str = "main";
pub const LIST_MAIN_NAME: &str = "Home";

const ROOT_ITEMS: &str = "items";
const ROOT_LISTS: &str = "lists";

const KEY_ID: &str = "id";
const KEY_TEXT: &str = "text";
const KEY_NOTES: &str = "notes";
const KEY_LIST_ID: &str = "list_id";
const KEY_NAME: &str = "name";
const KEY_CREATED_AT: &str = "created_at";
const KEY_DONE_AT: &str = "done_at";
const KEY_BINNED_AT: &str = "binned_at";

#[derive(Debug, thiserror::Error)]
pub enum DocError {
    #[error("loro: {0}")]
    Loro(String),
    #[error("item not found: {0}")]
    ItemNotFound(String),
    #[error("list not found: {0}")]
    ListNotFound(String),
    #[error("can't delete the built-in list `{0}`")]
    CannotDeleteBuiltin(String),
    #[error("can't move the built-in list `{0}`")]
    CannotMoveBuiltin(String),
    #[error("can't rename the built-in list `{0}`")]
    CannotRenameBuiltin(String),
    #[error("item is not in the bin")]
    NotBinned,
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("crypto: {0}")]
    Crypto(#[from] crate::crypto::CryptoError),
    #[error("persistence decode: {0}")]
    Persistence(#[from] rmp_serde::decode::Error),
    #[error("persistence encode: {0}")]
    PersistenceEncode(#[from] rmp_serde::encode::Error),
}

impl From<loro::LoroError> for DocError {
    fn from(e: loro::LoroError) -> Self {
        DocError::Loro(e.to_string())
    }
}

impl From<loro::LoroEncodeError> for DocError {
    fn from(e: loro::LoroEncodeError) -> Self {
        DocError::Loro(e.to_string())
    }
}

/// Stable view of a single item, surfaced to clients (CLI list, fingerprint).
/// `done_at`/`binned_at` are independent: an item can be both done and
/// binned. `done` and `binned` are derived predicates, not stored fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemView {
    pub id: String,
    pub text: String,
    pub notes: String,
    pub list_id: String,
    pub created_at: i64,
    pub done_at: Option<i64>,
    pub binned_at: Option<i64>,
}

impl ItemView {
    pub fn is_done(&self) -> bool {
        self.done_at.is_some()
    }
    pub fn is_binned(&self) -> bool {
        self.binned_at.is_some()
    }
    /// Visible in a per-list view: neither done nor binned.
    pub fn is_in_list_view(&self) -> bool {
        !self.is_done() && !self.is_binned()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListView {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JsonExport {
    pub version: u32,
    pub lists: Vec<ExportList>,
    pub items: Vec<ExportItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportList {
    pub id: String,
    pub name: String,
    pub created_at: Option<i64>,
    pub builtin: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportItem {
    pub id: String,
    pub text: String,
    pub notes: String,
    pub list_id: String,
    pub created_at: i64,
    pub done_at: Option<i64>,
    pub binned_at: Option<i64>,
}

pub struct Doc {
    inner: LoroDoc,
    last_pushed_vv: VersionVector,
    /// Domain-level change events. Mutation methods push directly;
    /// `apply_remote` does state-diff and pushes a batch. Drain via
    /// `pop_event` / `drain_events`. Wrapped in `Mutex` so mutation
    /// methods can stay `&self` (Loro's interior-mutability shape).
    events: Mutex<VecDeque<AppEvent>>,
    /// Per-session undo/redo. Bound to the local peer at construction;
    /// only records local commits. Remote ops imported by
    /// `apply_remote` carry origin `"remote"` and are filtered out by
    /// prefix — see `spec/sync-protocol.md` "Commit origin tagging".
    undo: Mutex<UndoManager>,
}

/// Configure an UndoManager bound to `inner`, excluding remote-tagged
/// commits. Construct *after* any seeding/snapshot import so those
/// operations aren't eligible for undo.
fn make_undo_manager(inner: &LoroDoc) -> UndoManager {
    let mut um = UndoManager::new(inner);
    um.add_exclude_origin_prefix("remote");
    um
}

impl Doc {
    /// New doc with built-in state initialised. There are no persisted
    /// user-list seeds; only the virtual built-in `main` exists at
    /// first open. Device-2 bootstrap via snapshot bypasses this path
    /// entirely.
    pub fn new() -> Result<Self, DocError> {
        let inner = LoroDoc::new();
        if seed_builtins(&inner)? {
            inner.commit();
        }
        let undo = Mutex::new(make_undo_manager(&inner));
        Ok(Self {
            inner,
            last_pushed_vv: VersionVector::default(),
            events: Mutex::new(VecDeque::new()),
            undo,
        })
    }

    /// Empty doc — used by device 2 before snapshot import.
    pub fn empty() -> Self {
        let inner = LoroDoc::new();
        let undo = Mutex::new(make_undo_manager(&inner));
        Self {
            last_pushed_vv: inner.oplog_vv(),
            inner,
            events: Mutex::new(VecDeque::new()),
            undo,
        }
    }

    pub fn last_pushed_vv(&self) -> &VersionVector {
        &self.last_pushed_vv
    }

    /// Snapshot of the oplog VV — every commit currently in the log,
    /// across every peer we've seen. Sync engine captures this at the
    /// moment of `pending_export` and feeds it back via
    /// `mark_pushed_at` on ack so a mutation made *during* the in-flight
    /// push doesn't get marked-as-pushed alongside the ops on the wire.
    pub fn oplog_vv(&self) -> VersionVector {
        self.inner.oplog_vv()
    }

    /// True iff there are local commits the server hasn't seen.
    pub fn has_pending_ops(&self) -> bool {
        // `Updates { from: oplog_vv }` is empty; `Updates { from: VV<oplog }` isn't.
        self.inner.oplog_vv() != self.last_pushed_vv
    }

    // ---------- mutations: items ----------

    pub fn add_item(&self, list_id: &str, text: &str) -> Result<String, DocError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(DocError::Invalid("item text is empty".into()));
        }
        self.assert_list_exists(list_id)?;
        let items = self.items();
        let map = items.push_container(LoroMap::new())?;
        let id = new_id();
        let now = now_millis();
        map.insert(KEY_ID, id.as_str())?;
        map.insert(KEY_TEXT, text)?;
        map.insert(KEY_LIST_ID, list_id)?;
        map.insert(KEY_CREATED_AT, now)?;
        self.inner.commit();
        let index = self
            .visible_item_index(&id)
            .ok_or_else(|| DocError::ItemNotFound(id.clone()))?;
        self.push_event(AppEvent::ItemAdded {
            id: id.clone(),
            list_id: list_id.to_string(),
            text: text.to_string(),
            notes: String::new(),
            created_at: now,
            done_at: None,
            binned_at: None,
            index,
        });
        Ok(id)
    }

    /// Insert a new item as the `target_index`-th live entry of
    /// `list_id`, in a single Loro op. `target_index` past the end of
    /// the visible live items appends. Use this in preference to
    /// `add_item` + `move_item` whenever the caller knows the
    /// destination — it skips the intermediate "appended at end" state
    /// peers and the local UI would otherwise observe.
    pub fn add_item_at(
        &self,
        list_id: &str,
        text: &str,
        target_index: usize,
    ) -> Result<String, DocError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(DocError::Invalid("item text is empty".into()));
        }
        self.assert_list_exists(list_id)?;
        let items = self.items();
        let abs = absolute_insertion_index_for_list_position(&items, list_id, target_index);
        let (id, now) = self.write_new_item(&items, list_id, text, abs)?;
        self.inner.commit();
        let index = self
            .visible_item_index(&id)
            .ok_or_else(|| DocError::ItemNotFound(id.clone()))?;
        self.push_event(AppEvent::ItemAdded {
            id: id.clone(),
            list_id: list_id.to_string(),
            text: text.to_string(),
            notes: String::new(),
            created_at: now,
            done_at: None,
            binned_at: None,
            index,
        });
        Ok(id)
    }

    /// Bulk-insert `texts` as a contiguous run of live items starting
    /// at the `target_index`-th visible position of `list_id`. All
    /// inserts land in a single Loro commit (one outbound op group).
    /// Validation is upfront: any empty-after-trim entry rejects the
    /// whole batch so callers don't see partial state.
    pub fn add_items_at(
        &self,
        list_id: &str,
        texts: &[&str],
        target_index: usize,
    ) -> Result<Vec<String>, DocError> {
        let trimmed: Vec<&str> = texts.iter().map(|t| t.trim()).collect();
        if trimmed.iter().any(|t| t.is_empty()) {
            return Err(DocError::Invalid("item text is empty".into()));
        }
        self.assert_list_exists(list_id)?;
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }
        let items = self.items();
        let initial_abs = absolute_insertion_index_for_list_position(&items, list_id, target_index);
        let mut ids = Vec::with_capacity(trimmed.len());
        let mut pending = Vec::with_capacity(trimmed.len());
        for (i, text) in trimmed.iter().enumerate() {
            let abs = initial_abs + i;
            let (id, now) = self.write_new_item(&items, list_id, text, abs)?;
            pending.push((id.clone(), (*text).to_string(), now));
            ids.push(id);
        }
        self.inner.commit();
        for (id, text, now) in pending {
            let index = self
                .visible_item_index(&id)
                .ok_or_else(|| DocError::ItemNotFound(id.clone()))?;
            self.push_event(AppEvent::ItemAdded {
                id,
                list_id: list_id.to_string(),
                text,
                notes: String::new(),
                created_at: now,
                done_at: None,
                binned_at: None,
                index,
            });
        }
        Ok(ids)
    }

    pub fn edit_item_text(&self, item_id: &str, text: &str) -> Result<(), DocError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(DocError::Invalid("item text is empty".into()));
        }
        let (_, map) = self.find_item(item_id)?;
        map.insert(KEY_TEXT, text)?;
        self.inner.commit();
        self.push_event(AppEvent::ItemTextChanged {
            id: item_id.to_string(),
            text: text.to_string(),
        });
        Ok(())
    }

    /// Set an item's free-form notes. Empty is allowed (clears the
    /// note); leading/trailing whitespace is preserved verbatim because
    /// notes are intentionally a freeform plain-text field.
    pub fn edit_item_notes(&self, item_id: &str, notes: &str) -> Result<(), DocError> {
        let (_, map) = self.find_item(item_id)?;
        map.insert(KEY_NOTES, notes)?;
        self.inner.commit();
        self.push_event(AppEvent::ItemNotesChanged {
            id: item_id.to_string(),
            notes: notes.to_string(),
        });
        Ok(())
    }

    pub fn move_item(
        &self,
        item_id: &str,
        target_list_id: &str,
        target_index: usize,
    ) -> Result<(), DocError> {
        self.assert_list_exists(target_list_id)?;
        let (idx, map) = self.find_item(item_id)?;
        let prev_list_id = read_string(&map, KEY_LIST_ID);
        let abs = self.move_item_inner(item_id, target_list_id, target_index)?;
        self.inner.commit();
        let index = self
            .visible_item_index(item_id)
            .ok_or_else(|| DocError::ItemNotFound(item_id.to_string()))?;
        if prev_list_id.as_deref() != Some(target_list_id) {
            self.push_event(AppEvent::ItemListChanged {
                id: item_id.to_string(),
                list_id: target_list_id.to_string(),
            });
        }
        if abs != idx {
            self.push_event(AppEvent::ItemMoved {
                id: item_id.to_string(),
                index,
            });
        }
        Ok(())
    }

    /// Set or clear an item's done state. Independent of `binned` —
    /// flipping done leaves `binned_at` untouched.
    pub fn set_item_done(&self, item_id: &str, done: bool) -> Result<(), DocError> {
        let (_, map) = self.find_item(item_id)?;
        let prev_done = read_i64(&map, KEY_DONE_AT);
        let new_done = match (done, prev_done) {
            (true, Some(_)) => return Ok(()),
            (false, None) => return Ok(()),
            (true, None) => Some(now_millis()),
            (false, Some(_)) => None,
        };
        match new_done {
            Some(t) => {
                map.insert(KEY_DONE_AT, t)?;
            }
            None => {
                let _ = map.delete(KEY_DONE_AT);
            }
        }
        let binned_at = read_i64(&map, KEY_BINNED_AT);
        self.inner.commit();
        self.push_event(AppEvent::ItemStatusChanged {
            id: item_id.to_string(),
            done_at: new_done,
            binned_at,
        });
        Ok(())
    }

    /// Set or clear done state for many items in one commit.
    pub fn set_items_done(&self, item_ids: &[&str], done: bool) -> Result<(), DocError> {
        if item_ids.is_empty() {
            return Ok(());
        }
        assert_unique_item_ids(item_ids)?;
        let pre_items: Vec<ItemView> = self.iter_items().collect();
        let mut changed = false;
        for item_id in item_ids {
            let (_, map) = self.find_item(item_id)?;
            let prev_done = read_i64(&map, KEY_DONE_AT);
            let new_done = match (done, prev_done) {
                (true, Some(_)) | (false, None) => continue,
                (true, None) => Some(now_millis()),
                (false, Some(_)) => None,
            };
            changed = true;
            match new_done {
                Some(t) => {
                    map.insert(KEY_DONE_AT, t)?;
                }
                None => {
                    let _ = map.delete(KEY_DONE_AT);
                }
            }
        }
        if changed {
            self.inner.commit();
            self.emit_item_diffs(&pre_items);
        }
        Ok(())
    }

    /// Set or clear an item's binned state. Independent of `done` —
    /// binning a done item keeps it done; restoring (unbinning) leaves
    /// the done state alone.
    pub fn set_item_binned(&self, item_id: &str, binned: bool) -> Result<(), DocError> {
        let (_, map) = self.find_item(item_id)?;
        let prev_binned = read_i64(&map, KEY_BINNED_AT);
        let new_binned = match (binned, prev_binned) {
            (true, Some(_)) => return Ok(()),
            (false, None) => return Ok(()),
            (true, None) => Some(now_millis()),
            (false, Some(_)) => None,
        };
        match new_binned {
            Some(t) => {
                map.insert(KEY_BINNED_AT, t)?;
            }
            None => {
                let _ = map.delete(KEY_BINNED_AT);
            }
        }
        let done_at = read_i64(&map, KEY_DONE_AT);
        self.inner.commit();
        self.push_event(AppEvent::ItemStatusChanged {
            id: item_id.to_string(),
            done_at,
            binned_at: new_binned,
        });
        Ok(())
    }

    /// Set or clear binned state for many items in one commit.
    pub fn set_items_binned(&self, item_ids: &[&str], binned: bool) -> Result<(), DocError> {
        if item_ids.is_empty() {
            return Ok(());
        }
        assert_unique_item_ids(item_ids)?;
        let pre_items: Vec<ItemView> = self.iter_items().collect();
        let mut changed = false;
        for item_id in item_ids {
            let (_, map) = self.find_item(item_id)?;
            let prev_binned = read_i64(&map, KEY_BINNED_AT);
            let new_binned = match (binned, prev_binned) {
                (true, Some(_)) | (false, None) => continue,
                (true, None) => Some(now_millis()),
                (false, Some(_)) => None,
            };
            changed = true;
            match new_binned {
                Some(t) => {
                    map.insert(KEY_BINNED_AT, t)?;
                }
                None => {
                    let _ = map.delete(KEY_BINNED_AT);
                }
            }
        }
        if changed {
            self.inner.commit();
            self.emit_item_diffs(&pre_items);
        }
        Ok(())
    }

    pub fn delete_binned(&self, item_id: &str) -> Result<(), DocError> {
        let (idx, map) = self.find_item(item_id)?;
        if read_i64(&map, KEY_BINNED_AT).is_none() {
            return Err(DocError::NotBinned);
        }
        self.items().delete(idx, 1)?;
        self.inner.commit();
        self.push_event(AppEvent::ItemRemoved {
            id: item_id.to_string(),
        });
        Ok(())
    }

    /// Hard-delete the subset of binned items identified by `item_ids`
    /// in one commit. Errors if any id is not currently binned.
    pub fn delete_binned_items(&self, item_ids: &[&str]) -> Result<(), DocError> {
        if item_ids.is_empty() {
            return Ok(());
        }
        assert_unique_item_ids(item_ids)?;
        let pre_items: Vec<ItemView> = self.iter_items().collect();
        let mut positions = Vec::with_capacity(item_ids.len());
        for item_id in item_ids {
            let (idx, map) = self.find_item(item_id)?;
            if read_i64(&map, KEY_BINNED_AT).is_none() {
                return Err(DocError::NotBinned);
            }
            positions.push(idx);
        }
        positions.sort_unstable();
        let items = self.items();
        for idx in positions.into_iter().rev() {
            items.delete(idx, 1)?;
        }
        self.inner.commit();
        self.emit_item_diffs(&pre_items);
        Ok(())
    }

    /// Hard-deletes every binned item. Walks back-to-front so deletions
    /// don't shift indices we haven't visited yet.
    pub fn empty_bin(&self) -> Result<usize, DocError> {
        let items = self.items();
        let mut removed_ids = Vec::new();
        for idx in (0..items.len()).rev() {
            let Some(map) = item_map_at(&items, idx) else {
                continue;
            };
            if read_i64(&map, KEY_BINNED_AT).is_some() {
                if let Some(id) = read_string(&map, KEY_ID) {
                    removed_ids.push(id);
                }
                items.delete(idx, 1)?;
            }
        }
        if !removed_ids.is_empty() {
            self.inner.commit();
            for id in &removed_ids {
                self.push_event(AppEvent::ItemRemoved { id: id.clone() });
            }
        }
        Ok(removed_ids.len())
    }

    // ---------- mutations: lists ----------

    pub fn add_list(&self, name: &str) -> Result<String, DocError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DocError::Invalid("list name is empty".into()));
        }
        let id = new_id();
        let lists = self.lists();
        let map = lists.push_container(LoroMap::new())?;
        let now = now_millis();
        map.insert(KEY_ID, id.as_str())?;
        map.insert(KEY_NAME, name)?;
        map.insert(KEY_CREATED_AT, now)?;
        self.inner.commit();
        let index = self
            .visible_list_index(&id)
            .ok_or_else(|| DocError::ListNotFound(id.clone()))?;
        self.push_event(AppEvent::ListAdded {
            id: id.clone(),
            name: name.to_string(),
            created_at: now,
            index,
        });
        Ok(id)
    }

    pub fn rename_list(&self, list_id: &str, name: &str) -> Result<(), DocError> {
        if list_id == LIST_MAIN {
            return Err(DocError::CannotRenameBuiltin(LIST_MAIN.into()));
        }
        let name = name.trim();
        let (_, map) = self.find_list(list_id)?;
        map.insert(KEY_NAME, name)?;
        self.inner.commit();
        self.push_event(AppEvent::ListRenamed {
            id: list_id.to_string(),
            name: name.to_string(),
        });
        Ok(())
    }

    pub fn move_list(&self, list_id: &str, target_index: usize) -> Result<(), DocError> {
        if list_id == LIST_MAIN {
            return Err(DocError::CannotMoveBuiltin(LIST_MAIN.into()));
        }
        let lists = self.lists();
        let (from, _) = self.find_list(list_id)?;
        let len = lists.len();
        let to = target_index.min(len.saturating_sub(1));
        if from == to {
            return Ok(());
        }
        lists.mov(from, to)?;
        self.inner.commit();
        let index = self
            .visible_list_index(list_id)
            .ok_or_else(|| DocError::ListNotFound(list_id.to_string()))?;
        self.push_event(AppEvent::ListMoved {
            id: list_id.to_string(),
            index,
        });
        Ok(())
    }

    /// Refuses for the always-on `now` list. Items in the deleted
    /// list are reassigned to `now` so nothing falls off the doc.
    pub fn delete_list(&self, list_id: &str) -> Result<(), DocError> {
        if list_id == LIST_MAIN {
            return Err(DocError::CannotDeleteBuiltin(LIST_MAIN.into()));
        }
        let (idx, _) = self.find_list(list_id)?;
        let items = self.items();
        let mut reassigned: Vec<String> = Vec::new();
        for i in 0..items.len() {
            let Some(map) = item_map_at(&items, i) else {
                continue;
            };
            if read_string(&map, KEY_LIST_ID).as_deref() == Some(list_id) {
                map.insert(KEY_LIST_ID, LIST_MAIN)?;
                if let Some(id) = read_string(&map, KEY_ID) {
                    reassigned.push(id);
                }
            }
        }
        self.lists().delete(idx, 1)?;
        self.inner.commit();
        for id in reassigned {
            self.push_event(AppEvent::ItemListChanged {
                id,
                list_id: LIST_MAIN.to_string(),
            });
        }
        self.push_event(AppEvent::ListRemoved {
            id: list_id.to_string(),
        });
        Ok(())
    }

    // ---------- reads ----------

    pub fn items_in_list(&self, list_id: &str, include_binned: bool) -> Vec<ItemView> {
        self.iter_items()
            .filter(|i| i.list_id == list_id && (include_binned || !i.is_binned()))
            .collect()
    }

    pub fn binned_items(&self) -> Vec<ItemView> {
        self.iter_items().filter(|i| i.is_binned()).collect()
    }

    pub fn all_lists(&self) -> Vec<ListView> {
        let lists = self.lists();
        let mut out = Vec::with_capacity(lists.len());
        for i in 0..lists.len() {
            if let Some(map) = list_map_at(&lists, i) {
                if let Some(view) = list_view(&map) {
                    out.push(view);
                }
            }
        }
        out
    }

    /// Semantic full-account export. This is intentionally a compact,
    /// human-readable data dump rather than a CRDT/state backup.
    pub fn export_json(&self) -> JsonExport {
        let mut lists = Vec::with_capacity(self.lists().len() + 1);
        lists.push(ExportList {
            id: LIST_MAIN.to_string(),
            name: LIST_MAIN_NAME.to_string(),
            created_at: None,
            builtin: true,
        });
        lists.extend(self.all_lists().into_iter().map(|list| ExportList {
            id: list.id,
            name: list.name,
            created_at: Some(list.created_at),
            builtin: false,
        }));

        let items = self
            .iter_items()
            .map(|item| ExportItem {
                id: item.id,
                text: item.text,
                notes: item.notes,
                list_id: item.list_id,
                created_at: item.created_at,
                done_at: item.done_at,
                binned_at: item.binned_at,
            })
            .collect();

        JsonExport {
            version: 1,
            lists,
            items,
        }
    }

    /// Pretty-printed JSON dump of `export_json` — what the web client
    /// hands the user as `airday-*.json`. Pretty by default because the
    /// file is meant to be opened in a text editor; consumers wanting a
    /// compact form can re-serialize. Serialization of `JsonExport` is
    /// statically infallible (only strings, ints, bools, vecs, options),
    /// so the `expect` is a structural invariant, not user-reachable.
    pub fn export_json_string(&self) -> String {
        serde_json::to_string_pretty(&self.export_json())
            .expect("JsonExport contains only primitives — serialization is infallible")
    }

    pub fn get_item(&self, item_id: &str) -> Option<ItemView> {
        let (_, map) = self.find_item(item_id).ok()?;
        item_view(&map)
    }

    pub fn get_list_meta(&self, list_id: &str) -> Option<ListView> {
        let (_, map) = self.find_list(list_id).ok()?;
        list_view(&map)
    }

    /// Per-list nav view: ids of items in this list that are neither
    /// done nor binned, in MovableList order. Items whose `list_id` no
    /// longer exists (orphaned by `delete_list`'s reassignment to
    /// `main`) won't appear here for the deleted id by definition —
    /// they're now under `main`.
    pub fn live_item_ids(&self, list_id: &str) -> Vec<String> {
        self.iter_items()
            .filter(|i| i.list_id == list_id && i.is_in_list_view())
            .map(|i| i.id)
            .collect()
    }

    /// Cross-list "Done" view: ids of done-but-not-binned items, sorted
    /// by `done_at` descending. Ties broken by id ascending so the
    /// order is deterministic across devices despite client-clock skew.
    /// Binned items are excluded — Bin owns them in the UI even if
    /// they're also done.
    pub fn done_item_ids(&self) -> Vec<String> {
        let mut items: Vec<ItemView> = self
            .iter_items()
            .filter(|i| i.is_done() && !i.is_binned())
            .collect();
        items.sort_by(|a, b| {
            let at = a.done_at.unwrap_or(0);
            let bt = b.done_at.unwrap_or(0);
            bt.cmp(&at).then_with(|| a.id.cmp(&b.id))
        });
        items.into_iter().map(|i| i.id).collect()
    }

    /// Cross-list "Bin" view: ids sorted by `binned_at` descending.
    /// Includes items that are also done — done-ness is preserved when
    /// binning. Same tiebreaker as `done_item_ids`.
    pub fn binned_item_ids(&self) -> Vec<String> {
        let mut items: Vec<ItemView> = self.iter_items().filter(|i| i.is_binned()).collect();
        items.sort_by(|a, b| {
            let at = a.binned_at.unwrap_or(0);
            let bt = b.binned_at.unwrap_or(0);
            bt.cmp(&at).then_with(|| a.id.cmp(&b.id))
        });
        items.into_iter().map(|i| i.id).collect()
    }

    fn iter_items(&self) -> impl Iterator<Item = ItemView> + '_ {
        let items = self.items();
        (0..items.len()).filter_map(move |i| item_map_at(&items, i).and_then(|m| item_view(&m)))
    }

    // ---------- op stream ----------

    /// Encrypted full-state snapshot at the doc's current frontier.
    /// Used by the sync engine to satisfy a server `SnapshotRequest`.
    /// Independent of `last_pushed_vv` — the snapshot covers the whole
    /// doc, not a delta — so this does not advance any push-state
    /// bookkeeping; producing a snapshot is side-effect-free locally.
    pub fn snapshot_blob(&self, dek: &Dek) -> Result<EncryptedBlob, DocError> {
        let plaintext = self.export_snapshot_bytes()?;
        let (ciphertext, nonce) = dek.seal(&plaintext)?;
        Ok(EncryptedBlob {
            nonce: nonce.to_vec(),
            ciphertext,
        })
    }

    /// Plaintext full-state Loro snapshot. Same bytes that
    /// `snapshot_blob` seals for the server, but unencrypted — for
    /// user-driven backup / interop. Loro's import on a fresh doc
    /// reconstructs identical state from this blob.
    pub fn export_snapshot_bytes(&self) -> Result<Vec<u8>, DocError> {
        Ok(self.inner.export(ExportMode::Snapshot)?)
    }

    /// Encrypted blob containing every commit since `last_pushed_vv`.
    /// Returns `None` if there's nothing new to ship.
    pub fn pending_export(&self, dek: &Dek) -> Result<Option<EncryptedBlob>, DocError> {
        if !self.has_pending_ops() {
            return Ok(None);
        }
        let plaintext = self
            .inner
            .export(ExportMode::updates(&self.last_pushed_vv))?;
        let (ciphertext, nonce) = dek.seal(&plaintext)?;
        Ok(Some(EncryptedBlob {
            nonce: nonce.to_vec(),
            ciphertext,
        }))
    }

    /// Mark the local view as "everything currently in oplog has now
    /// been shipped." Caller-friendly shortcut for the common
    /// synchronous case (CLI tests). The sync engine uses
    /// `mark_pushed_at` instead so a concurrent local mutation between
    /// `pending_export` and the server's `OpsAck` isn't silently
    /// included in the advance.
    pub fn mark_pushed(&mut self) {
        let vv = self.inner.oplog_vv();
        self.last_pushed_vv.merge(&vv);
    }

    /// Encoded current oplog VersionVector. The browser WAL adapter
    /// (`spec/idb-wal.md`) keeps the VV captured after the previous
    /// commit and asks for everything strictly after it on the next
    /// commit — that delta is what the WAL row stores.
    pub fn oplog_vv_bytes(&self) -> Vec<u8> {
        self.inner.oplog_vv().encode()
    }

    /// Export Loro updates strictly after `from_vv_bytes`. Returns the
    /// raw plaintext update blob (the JS layer encrypts it before
    /// writing to IndexedDB). Decoupled from `pending_export` because
    /// the WAL frontier is independent of the sync push frontier — a
    /// freshly committed local op needs to land in the WAL before it's
    /// considered durable, regardless of whether the server has it.
    pub fn export_updates_after_bytes(&self, from_vv_bytes: &[u8]) -> Result<Vec<u8>, DocError> {
        // Empty input means "from genesis" — convenient cursor for the
        // first WAL append on a fresh-signup boot, before any
        // `oplog_vv_bytes()` has been captured. (Loro's wire encoding of
        // an empty VV is one byte `[0]`; an empty slice would otherwise
        // fail decode.)
        let vv = if from_vv_bytes.is_empty() {
            VersionVector::default()
        } else {
            VersionVector::decode(from_vv_bytes).map_err(|e| DocError::Loro(e.to_string()))?
        };
        Ok(self.inner.export(ExportMode::updates(&vv))?)
    }

    /// Apply WAL replay bytes during boot. Tagged `"remote"` so the
    /// freshly-rebuilt UndoManager (constructed by `Doc::load`) skips
    /// them — undo state is per-session anyway, and reloading a tab
    /// shouldn't resurrect undoable steps.
    ///
    /// Does *not* advance `last_pushed_vv`. Whether the original local
    /// commit reached the server before the crash is unknowable from
    /// disk; the next push retries, and Loro / the server dedupe.
    pub fn import_wal_updates(&mut self, plaintext: &[u8]) -> Result<(), DocError> {
        self.inner.import_with(plaintext, "remote")?;
        Ok(())
    }

    /// Merge `vv` into `last_pushed_vv`. Pair with `oplog_vv()` captured
    /// at the moment of `pending_export` — on the server's ack, this
    /// advances only past the ops that were actually on the wire,
    /// leaving any concurrently-committed local mutations in the
    /// pending set.
    pub fn mark_pushed_at(&mut self, vv: VersionVector) {
        self.last_pushed_vv.merge(&vv);
    }

    /// Decrypt and apply a peer op blob. Advances `last_pushed_vv` for
    /// the imported peers only — the server clearly has those ops, but
    /// any local commits already in the oplog stay in the pending set
    /// until our own push lands.
    ///
    /// Snapshots state before the import and diffs after, pushing
    /// per-id `AppEvent`s into the queue so consumers can mirror the
    /// changes into a UI store with surgical writes — without having
    /// to walk Loro's per-container diff tree.
    pub fn apply_remote(&mut self, dek: &Dek, blob: &EncryptedBlob) -> Result<(), DocError> {
        self.apply_remote_batch(dek, std::iter::once(blob))
    }

    /// Batch variant of [`Doc::apply_remote`]. Imports all blobs first,
    /// then diffs once so catch-up batches don't pay whole-doc
    /// snapshot/diff cost per op.
    pub fn apply_remote_batch<'a, I>(&mut self, dek: &Dek, blobs: I) -> Result<(), DocError>
    where
        I: IntoIterator<Item = &'a EncryptedBlob>,
    {
        let pre_items: Vec<ItemView> = self.iter_items().collect();
        let pre_lists: Vec<ListView> = self.all_lists();

        for blob in blobs {
            self.import_remote_blob(dek, blob)?;
        }

        self.emit_state_diff(&pre_items, &pre_lists);
        Ok(())
    }

    // ---------- undo / redo ----------

    /// Undo the most recent eligible local commit. Remote-applied ops
    /// are filtered out by origin prefix and never enter the stack.
    /// Returns `true` if a step was applied. Diffs state pre/post and
    /// emits per-id `AppEvent`s the same way `apply_remote` does —
    /// undo bypasses the per-mutation event-pushing.
    pub fn undo(&self) -> Result<bool, DocError> {
        self.apply_undo_op(|um| um.undo())
    }

    /// Redo the most recently undone step.
    pub fn redo(&self) -> Result<bool, DocError> {
        self.apply_undo_op(|um| um.redo())
    }

    pub fn can_undo(&self) -> bool {
        self.undo.lock().map(|um| um.can_undo()).unwrap_or(false)
    }

    pub fn can_redo(&self) -> bool {
        self.undo.lock().map(|um| um.can_redo()).unwrap_or(false)
    }

    fn apply_undo_op<F>(&self, op: F) -> Result<bool, DocError>
    where
        F: FnOnce(&mut UndoManager) -> loro::LoroResult<bool>,
    {
        let pre_items: Vec<ItemView> = self.iter_items().collect();
        let pre_lists: Vec<ListView> = self.all_lists();
        let did = {
            let mut um = self.undo.lock().expect("undo mutex poisoned");
            op(&mut um)?
        };
        if did {
            self.emit_state_diff(&pre_items, &pre_lists);
        }
        Ok(did)
    }

    // ---------- event queue ----------

    /// Pop the next domain event, FIFO. UI consumers drain this on each
    /// engine tick. See `snapshot_events` for the synthetic backfill
    /// emitted on first attach.
    pub fn pop_event(&self) -> Option<AppEvent> {
        self.events.lock().ok()?.pop_front()
    }

    /// Drain everything currently queued.
    pub fn drain_events(&self) -> Vec<AppEvent> {
        self.events
            .lock()
            .map(|mut q| q.drain(..).collect())
            .unwrap_or_default()
    }

    /// Synthetic event burst for current state. A fresh consumer calls
    /// this once on attach to materialize lists + items via the same
    /// dispatcher it uses for live deltas — no separate "load initial"
    /// code path.
    pub fn snapshot_events(&self) -> Vec<AppEvent> {
        let mut out = Vec::new();
        for (idx, list) in self.all_lists().into_iter().enumerate() {
            out.push(AppEvent::ListAdded {
                id: list.id,
                name: list.name,
                created_at: list.created_at,
                index: idx,
            });
        }
        for (idx, item) in self.iter_items().enumerate() {
            out.push(AppEvent::ItemAdded {
                id: item.id,
                list_id: item.list_id,
                text: item.text,
                notes: item.notes,
                created_at: item.created_at,
                done_at: item.done_at,
                binned_at: item.binned_at,
                index: idx,
            });
        }
        out
    }

    fn push_event(&self, ev: AppEvent) {
        if let Ok(mut q) = self.events.lock() {
            q.push_back(ev);
        }
    }

    // ---------- persistence ----------

    /// Serialize doc state + last-pushed VV for the on-disk
    /// `loro.bin`. Encoding is msgpack — small, additively evolvable,
    /// and matches the wire format used everywhere else.
    pub fn save(&self) -> Result<Vec<u8>, DocError> {
        let snapshot = self.inner.export(ExportMode::Snapshot)?;
        let envelope = LocalState {
            version: 1,
            snapshot,
            last_pushed_vv: self.last_pushed_vv.encode(),
        };
        Ok(rmp_serde::to_vec_named(&envelope)?)
    }

    pub fn load(bytes: &[u8]) -> Result<Self, DocError> {
        let envelope: LocalState = rmp_serde::from_slice(bytes)?;
        let inner = LoroDoc::new();
        inner.import(&envelope.snapshot)?;
        let last_pushed_vv = VersionVector::decode(&envelope.last_pushed_vv)
            .map_err(|e| DocError::Loro(e.to_string()))?;
        let undo = Mutex::new(make_undo_manager(&inner));
        Ok(Self {
            inner,
            last_pushed_vv,
            events: Mutex::new(VecDeque::new()),
            undo,
        })
    }

    // ---------- fingerprint ----------

    /// Logical-state hash. Stable across replicas at logical equality;
    /// used for convergence assertions in tests. Snapshot bytes are
    /// *not* stable (Loro stores per-replica metadata), so we hash a
    /// canonical serialization of the visible item / list state.
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        // Lists: walk by stored order because ordering is part of the
        // logical state surfaced to users.
        let lists = self.all_lists();
        hasher.update(b"L");
        hasher.update((lists.len() as u32).to_be_bytes());
        for l in &lists {
            hash_str(&mut hasher, &l.id);
            hash_str(&mut hasher, &l.name);
            hasher.update(l.created_at.to_be_bytes());
        }
        // Items: walk by MovableList order for the same reason.
        let items: Vec<ItemView> = self.iter_items().collect();
        hasher.update(b"I");
        hasher.update((items.len() as u32).to_be_bytes());
        for i in &items {
            hash_str(&mut hasher, &i.id);
            hash_str(&mut hasher, &i.text);
            hash_str(&mut hasher, &i.notes);
            hash_str(&mut hasher, &i.list_id);
            hasher.update(i.created_at.to_be_bytes());
            hash_opt_i64(&mut hasher, i.done_at);
            hash_opt_i64(&mut hasher, i.binned_at);
        }
        hasher.finalize().into()
    }

    // ---------- private ----------

    fn items(&self) -> LoroMovableList {
        self.inner.get_movable_list(ROOT_ITEMS)
    }

    fn lists(&self) -> LoroMovableList {
        self.inner.get_movable_list(ROOT_LISTS)
    }

    fn find_item(&self, item_id: &str) -> Result<(usize, LoroMap), DocError> {
        let items = self.items();
        for i in 0..items.len() {
            if let Some(map) = item_map_at(&items, i) {
                if read_string(&map, KEY_ID).as_deref() == Some(item_id) {
                    return Ok((i, map));
                }
            }
        }
        Err(DocError::ItemNotFound(item_id.into()))
    }

    fn find_list(&self, list_id: &str) -> Result<(usize, LoroMap), DocError> {
        let lists = self.lists();
        for i in 0..lists.len() {
            if let Some(map) = list_map_at(&lists, i) {
                if read_string(&map, KEY_ID).as_deref() == Some(list_id) {
                    return Ok((i, map));
                }
            }
        }
        Err(DocError::ListNotFound(list_id.into()))
    }

    fn visible_item_index(&self, item_id: &str) -> Option<usize> {
        self.iter_items().position(|it| it.id == item_id)
    }

    fn visible_list_index(&self, list_id: &str) -> Option<usize> {
        self.all_lists().iter().position(|l| l.id == list_id)
    }

    fn assert_list_exists(&self, list_id: &str) -> Result<(), DocError> {
        if list_id == LIST_MAIN {
            return Ok(());
        }
        self.find_list(list_id).map(|_| ())
    }

    /// Materialize a new live-item LoroMap at absolute position `abs`
    /// in `items` and populate the standard keys. Caller is responsible
    /// for the surrounding `commit()` and event emission so a batch can
    /// share both. Returns `(id, created_at)`.
    fn write_new_item(
        &self,
        items: &LoroMovableList,
        list_id: &str,
        text: &str,
        abs: usize,
    ) -> Result<(String, i64), DocError> {
        let map = if abs >= items.len() {
            items.push_container(LoroMap::new())?
        } else {
            items.insert_container(abs, LoroMap::new())?
        };
        let id = new_id();
        let now = now_millis();
        map.insert(KEY_ID, id.as_str())?;
        map.insert(KEY_TEXT, text)?;
        map.insert(KEY_LIST_ID, list_id)?;
        map.insert(KEY_CREATED_AT, now)?;
        Ok((id, now))
    }

    fn move_item_inner(
        &self,
        item_id: &str,
        target_list_id: &str,
        target_index: usize,
    ) -> Result<usize, DocError> {
        let (idx, map) = self.find_item(item_id)?;
        let moving_in_list_view =
            read_i64(&map, KEY_DONE_AT).is_none() && read_i64(&map, KEY_BINNED_AT).is_none();
        let items = self.items();
        let abs = absolute_index_for_list_position(
            &items,
            target_list_id,
            target_index,
            idx,
            moving_in_list_view,
        );
        map.insert(KEY_LIST_ID, target_list_id)?;
        if abs != idx {
            items.mov(idx, abs)?;
        }
        Ok(abs)
    }

    fn emit_item_diffs(&self, pre_items: &[ItemView]) {
        let post_items: Vec<ItemView> = self.iter_items().collect();
        let mut emitted = Vec::new();
        diff_items(pre_items, &post_items, &mut emitted);
        if !emitted.is_empty() {
            let mut q = self.events.lock().expect("events mutex poisoned");
            for ev in emitted {
                q.push_back(ev);
            }
        }
    }

    fn import_remote_blob(&mut self, dek: &Dek, blob: &EncryptedBlob) -> Result<(), DocError> {
        if blob.nonce.len() != AEAD_NONCE_LEN {
            return Err(DocError::Invalid(format!(
                "expected {AEAD_NONCE_LEN}-byte nonce, got {}",
                blob.nonce.len()
            )));
        }
        let plaintext = dek.open(&blob.ciphertext, &blob.nonce)?;
        let status = self.inner.import_with(&plaintext, "remote")?;
        // VersionRange is `(start, end)` per peer — `end` is the
        // exclusive upper bound, which matches `VersionVector`'s
        // counter semantics (cf. loro `VersionRange::from_vv`).
        let mut imported_vv = VersionVector::new();
        for (peer, (_, end)) in status.success.iter() {
            imported_vv.insert(*peer, *end);
        }
        self.last_pushed_vv.merge(&imported_vv);
        Ok(())
    }

    fn emit_state_diff(&self, pre_items: &[ItemView], pre_lists: &[ListView]) {
        let post_items: Vec<ItemView> = self.iter_items().collect();
        let post_lists: Vec<ListView> = self.all_lists();
        let mut emitted = Vec::new();
        diff_lists(pre_lists, &post_lists, &mut emitted);
        diff_items(pre_items, &post_items, &mut emitted);
        if !emitted.is_empty() {
            let mut q = self.events.lock().expect("events mutex poisoned");
            for ev in emitted {
                q.push_back(ev);
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
struct LocalState {
    version: u8,
    #[serde(with = "serde_bytes")]
    snapshot: Vec<u8>,
    #[serde(with = "serde_bytes")]
    last_pushed_vv: Vec<u8>,
}

fn assert_unique_item_ids(item_ids: &[&str]) -> Result<(), DocError> {
    let mut seen = HashSet::with_capacity(item_ids.len());
    for item_id in item_ids {
        if !seen.insert(*item_id) {
            return Err(DocError::Invalid(format!("duplicate item id: {item_id}")));
        }
    }
    Ok(())
}

fn seed_builtins(doc: &LoroDoc) -> Result<bool, DocError> {
    // `LIST_MAIN` is a *reserved id*, not a MovableList entry — items
    // reference it as the string "main" and clients render its label
    // client-side (until we add a meta CRDT for things like a custom
    // name). There are no persisted user-list seeds, but we still
    // materialise the user-list root container so fresh docs keep the
    // same top-level shape.
    let _ = doc.get_movable_list(ROOT_LISTS);
    Ok(false)
}

fn item_map_at(items: &LoroMovableList, idx: usize) -> Option<LoroMap> {
    match items.get(idx)? {
        ValueOrContainer::Container(Container::Map(m)) => Some(m),
        _ => None,
    }
}

fn list_map_at(lists: &LoroMovableList, idx: usize) -> Option<LoroMap> {
    match lists.get(idx)? {
        ValueOrContainer::Container(Container::Map(m)) => Some(m),
        _ => None,
    }
}

fn read_string(map: &LoroMap, key: &str) -> Option<String> {
    let v = map.get(key)?;
    let value = v.as_value()?.clone();
    value.into_string().ok().map(|s| s.to_string())
}

fn read_i64(map: &LoroMap, key: &str) -> Option<i64> {
    let v = map.get(key)?;
    let value = v.as_value()?.clone();
    value.into_i64().ok()
}

fn item_view(map: &LoroMap) -> Option<ItemView> {
    Some(ItemView {
        id: read_string(map, KEY_ID)?,
        text: read_string(map, KEY_TEXT)?,
        // Pre-notes items don't have the key — default to empty so old
        // snapshots load and items added before the migration round-trip
        // through `get_item` cleanly.
        notes: read_string(map, KEY_NOTES).unwrap_or_default(),
        list_id: read_string(map, KEY_LIST_ID)?,
        created_at: read_i64(map, KEY_CREATED_AT)?,
        done_at: read_i64(map, KEY_DONE_AT),
        binned_at: read_i64(map, KEY_BINNED_AT),
    })
}

fn list_view(map: &LoroMap) -> Option<ListView> {
    Some(ListView {
        id: read_string(map, KEY_ID)?,
        name: read_string(map, KEY_NAME)?,
        created_at: read_i64(map, KEY_CREATED_AT)?,
    })
}

/// Translate "insert as the Nth visible entry of `target_list_id`"
/// (i.e., among items that are neither done nor binned) into an
/// absolute index suitable for `LoroMovableList::insert_container` /
/// `push_container`. Returns `items.len()` when `target_index` is past
/// the end so the caller can fall back to `push_container`.
fn absolute_insertion_index_for_list_position(
    items: &LoroMovableList,
    target_list_id: &str,
    target_index: usize,
) -> usize {
    let mut seen = 0usize;
    for i in 0..items.len() {
        let Some(map) = item_map_at(items, i) else {
            continue;
        };
        if read_string(&map, KEY_LIST_ID).as_deref() != Some(target_list_id) {
            continue;
        }
        if !is_in_list_view(&map) {
            continue;
        }
        if seen == target_index {
            return i;
        }
        seen += 1;
    }
    items.len()
}

fn is_in_list_view(map: &LoroMap) -> bool {
    read_i64(map, KEY_DONE_AT).is_none() && read_i64(map, KEY_BINNED_AT).is_none()
}

/// Walk the items list and translate "the Nth entry in `target_list`"
/// into the corresponding absolute index. `current_idx` is excluded
/// from the count so move-to-current-position is a no-op rather than
/// off-by-one.
fn absolute_index_for_list_position(
    items: &LoroMovableList,
    target_list_id: &str,
    target_index: usize,
    current_idx: usize,
    moving_in_list_view: bool,
) -> usize {
    let mut matching = Vec::new();
    for i in 0..items.len() {
        if i == current_idx {
            continue;
        }
        let Some(map) = item_map_at(items, i) else {
            continue;
        };
        if read_string(&map, KEY_LIST_ID).as_deref() != Some(target_list_id) {
            continue;
        }
        // List-view reorders originate from the visible per-list view,
        // so done/binned items must not consume target slots.
        if moving_in_list_view && !is_in_list_view(&map) {
            continue;
        }
        matching.push(i);
    }
    let Some(&anchor) = matching.get(target_index) else {
        return items.len().saturating_sub(1);
    };
    // `target_index` is expressed in the post-move filtered view, but
    // Loro expects an absolute destination in the pre-move list. When
    // the item is moving forward, removing it shifts the anchor left by
    // one, so adjust the absolute index back into the current list.
    if current_idx < anchor {
        anchor.saturating_sub(1)
    } else {
        anchor
    }
}

fn hash_str(hasher: &mut Sha256, s: &str) {
    hasher.update((s.len() as u32).to_be_bytes());
    hasher.update(s.as_bytes());
}

fn hash_opt_i64(hasher: &mut Sha256, v: Option<i64>) {
    match v {
        Some(n) => {
            hasher.update([1u8]);
            hasher.update(n.to_be_bytes());
        }
        None => hasher.update([0u8]),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(target_arch = "wasm32")]
fn now_millis() -> i64 {
    js_sys::Date::now() as i64
}

fn new_id() -> String {
    Uuid::now_v7().simple().to_string()
}

/// Diff two ordered slices of `ItemView` by id and emit `AppEvent`s for
/// the transitions a UI store needs to mirror. Used by `apply_remote`
/// where Loro applies a possibly-large batch of peer ops in one go and
/// the cheapest path to per-id deltas is "snapshot before, snapshot
/// after, walk both maps once."
fn diff_items(pre: &[ItemView], post: &[ItemView], out: &mut Vec<AppEvent>) {
    let pre_by_id: HashMap<&str, (usize, &ItemView)> = pre
        .iter()
        .enumerate()
        .map(|(i, it)| (it.id.as_str(), (i, it)))
        .collect();
    let post_by_id: HashMap<&str, (usize, &ItemView)> = post
        .iter()
        .enumerate()
        .map(|(i, it)| (it.id.as_str(), (i, it)))
        .collect();

    for it in pre {
        if !post_by_id.contains_key(it.id.as_str()) {
            out.push(AppEvent::ItemRemoved { id: it.id.clone() });
        }
    }
    for (post_idx, post_it) in post.iter().enumerate() {
        match pre_by_id.get(post_it.id.as_str()) {
            None => {
                out.push(AppEvent::ItemAdded {
                    id: post_it.id.clone(),
                    list_id: post_it.list_id.clone(),
                    text: post_it.text.clone(),
                    notes: post_it.notes.clone(),
                    created_at: post_it.created_at,
                    done_at: post_it.done_at,
                    binned_at: post_it.binned_at,
                    index: post_idx,
                });
            }
            Some(&(pre_idx, pre_it)) => {
                if pre_it.text != post_it.text {
                    out.push(AppEvent::ItemTextChanged {
                        id: post_it.id.clone(),
                        text: post_it.text.clone(),
                    });
                }
                if pre_it.notes != post_it.notes {
                    out.push(AppEvent::ItemNotesChanged {
                        id: post_it.id.clone(),
                        notes: post_it.notes.clone(),
                    });
                }
                if pre_it.done_at != post_it.done_at || pre_it.binned_at != post_it.binned_at {
                    out.push(AppEvent::ItemStatusChanged {
                        id: post_it.id.clone(),
                        done_at: post_it.done_at,
                        binned_at: post_it.binned_at,
                    });
                }
                if pre_it.list_id != post_it.list_id {
                    out.push(AppEvent::ItemListChanged {
                        id: post_it.id.clone(),
                        list_id: post_it.list_id.clone(),
                    });
                }
                if pre_idx != post_idx {
                    out.push(AppEvent::ItemMoved {
                        id: post_it.id.clone(),
                        index: post_idx,
                    });
                }
            }
        }
    }
}

/// Diff two ordered slices of `ListView`. Mirror of `diff_items` for
/// the lists root container.
fn diff_lists(pre: &[ListView], post: &[ListView], out: &mut Vec<AppEvent>) {
    let pre_by_id: HashMap<&str, (usize, &ListView)> = pre
        .iter()
        .enumerate()
        .map(|(i, l)| (l.id.as_str(), (i, l)))
        .collect();
    let post_by_id: HashMap<&str, (usize, &ListView)> = post
        .iter()
        .enumerate()
        .map(|(i, l)| (l.id.as_str(), (i, l)))
        .collect();

    for l in pre {
        if !post_by_id.contains_key(l.id.as_str()) {
            out.push(AppEvent::ListRemoved { id: l.id.clone() });
        }
    }
    for (post_idx, post_l) in post.iter().enumerate() {
        match pre_by_id.get(post_l.id.as_str()) {
            None => {
                out.push(AppEvent::ListAdded {
                    id: post_l.id.clone(),
                    name: post_l.name.clone(),
                    created_at: post_l.created_at,
                    index: post_idx,
                });
            }
            Some(&(pre_idx, pre_l)) => {
                if pre_l.name != post_l.name {
                    out.push(AppEvent::ListRenamed {
                        id: post_l.id.clone(),
                        name: post_l.name.clone(),
                    });
                }
                if pre_idx != post_idx {
                    out.push(AppEvent::ListMoved {
                        id: post_l.id.clone(),
                        index: post_idx,
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::Dek;

    #[test]
    fn new_doc_has_no_persisted_lists() {
        // Main is a reserved id with no MovableList entry, and there
        // are no seeded user lists.
        let doc = Doc::new().unwrap();
        let lists = doc.all_lists();
        assert!(lists.is_empty());
        assert!(!lists.iter().any(|l| l.id == LIST_MAIN));
    }

    #[test]
    fn add_item_to_main_works_without_movable_list_entry() {
        // `LIST_MAIN` is virtual — items can address it even though
        // no MovableList entry exists for it.
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "milk").unwrap();
        assert_eq!(doc.get_item(&id).unwrap().list_id, LIST_MAIN);
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![id]);
    }

    #[test]
    fn move_list_refuses_main() {
        let doc = Doc::new().unwrap();
        assert!(matches!(
            doc.move_list(LIST_MAIN, 0).unwrap_err(),
            DocError::CannotMoveBuiltin(_)
        ));
    }

    #[test]
    fn rename_list_refuses_main() {
        let doc = Doc::new().unwrap();
        assert!(matches!(
            doc.rename_list(LIST_MAIN, "Today").unwrap_err(),
            DocError::CannotRenameBuiltin(_)
        ));
    }

    #[test]
    fn add_item_round_trips_through_get() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "buy milk").unwrap();
        let view = doc.get_item(&id).unwrap();
        assert_eq!(view.text, "buy milk");
        assert_eq!(view.list_id, LIST_MAIN);
        assert!(!view.is_done());
        assert!(!view.is_binned());
    }

    #[test]
    fn empty_text_rejected() {
        let doc = Doc::new().unwrap();
        let err = doc.add_item(LIST_MAIN, "   ").unwrap_err();
        assert!(matches!(err, DocError::Invalid(_)));
    }

    #[test]
    fn add_to_unknown_list_rejected() {
        let doc = Doc::new().unwrap();
        let err = doc.add_item("does-not-exist", "x").unwrap_err();
        assert!(matches!(err, DocError::ListNotFound(_)));
    }

    #[test]
    fn done_and_binned_are_orthogonal() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "thing").unwrap();
        doc.set_item_done(&id, true).unwrap();
        assert!(doc.get_item(&id).unwrap().is_done());
        // Binning a done item must keep it done.
        doc.set_item_binned(&id, true).unwrap();
        let v = doc.get_item(&id).unwrap();
        assert!(v.is_done(), "done state must survive binning");
        assert!(v.is_binned());
        // Restoring (unbinning) must keep it done.
        doc.set_item_binned(&id, false).unwrap();
        let v = doc.get_item(&id).unwrap();
        assert!(v.is_done(), "done state must survive restore");
        assert!(!v.is_binned());
        // Unmarking done leaves binned alone (already false here).
        doc.set_item_done(&id, false).unwrap();
        let v = doc.get_item(&id).unwrap();
        assert!(!v.is_done());
        assert!(!v.is_binned());
    }

    #[test]
    fn set_done_idempotent() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "thing").unwrap();
        doc.set_item_done(&id, true).unwrap();
        let first = doc.get_item(&id).unwrap().done_at.unwrap();
        let _ = doc.drain_events();
        doc.set_item_done(&id, true).unwrap();
        assert_eq!(doc.get_item(&id).unwrap().done_at, Some(first));
        assert!(doc.drain_events().is_empty(), "no-op must not emit events");
    }

    #[test]
    fn empty_bin_removes_only_binned() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "keep").unwrap();
        let b = doc.add_item(LIST_MAIN, "drop").unwrap();
        doc.set_item_binned(&b, true).unwrap();
        let removed = doc.empty_bin().unwrap();
        assert_eq!(removed, 1);
        assert!(doc.get_item(&a).is_some());
        assert!(doc.get_item(&b).is_none());
    }

    #[test]
    fn delete_binned_only_works_for_binned() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "live").unwrap();
        assert!(matches!(
            doc.delete_binned(&id).unwrap_err(),
            DocError::NotBinned
        ));
        doc.set_item_binned(&id, true).unwrap();
        doc.delete_binned(&id).unwrap();
        assert!(doc.get_item(&id).is_none());
    }

    #[test]
    fn delete_list_reassigns_items_to_now() {
        let doc = Doc::new().unwrap();
        let mylist = doc.add_list("Errands").unwrap();
        let id = doc.add_item(&mylist, "milk").unwrap();
        doc.delete_list(&mylist).unwrap();
        let view = doc.get_item(&id).unwrap();
        assert_eq!(view.list_id, LIST_MAIN);
    }

    #[test]
    fn delete_now_refused() {
        let doc = Doc::new().unwrap();
        assert!(matches!(
            doc.delete_list(LIST_MAIN).unwrap_err(),
            DocError::CannotDeleteBuiltin(_)
        ));
    }

    #[test]
    fn save_load_round_trip_preserves_state() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "persisted").unwrap();
        let bytes = doc.save().unwrap();
        let restored = Doc::load(&bytes).unwrap();
        assert_eq!(restored.get_item(&id).unwrap().text, "persisted");
    }

    #[test]
    fn pending_export_is_none_when_clean() {
        let mut doc = Doc::new().unwrap();
        doc.mark_pushed();
        let dek = Dek::generate();
        assert!(doc.pending_export(&dek).unwrap().is_none());
    }

    #[test]
    fn two_replicas_converge_via_op_exchange() {
        let dek = Dek::generate();

        // Replica A is the originator and creates the first item.
        let mut a = Doc::new().unwrap();
        let item_a = a.add_item(LIST_MAIN, "from A").unwrap();

        // Replica B starts empty. Real device-2 bootstrap typically
        // uses snapshot, but the convergence guarantee is what we're
        // testing.
        let mut b = Doc::empty();
        let blob_a1 = a.pending_export(&dek).unwrap().unwrap();
        a.mark_pushed();
        b.apply_remote(&dek, &blob_a1).unwrap();
        assert!(b.get_item(&item_a).is_some());

        // B mutates concurrently, ships back to A.
        let item_b = b.add_item(LIST_MAIN, "from B").unwrap();
        let blob_b1 = b.pending_export(&dek).unwrap().unwrap();
        b.mark_pushed();
        a.apply_remote(&dek, &blob_b1).unwrap();
        assert!(a.get_item(&item_b).is_some());

        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn fingerprint_diverges_when_state_diverges() {
        let mut a = Doc::new().unwrap();
        let mut b = Doc::new().unwrap();
        // Independently-initialised docs have the same logical state
        // (built-in lists with the same ids; created_at differs by
        // wall-clock millis but the test doesn't pin equal docs — it
        // just shows that adding-and-not-syncing diverges).
        let _ = a.add_item(LIST_MAIN, "A only").unwrap();
        let _ = b.add_item(LIST_MAIN, "B only").unwrap();
        a.mark_pushed();
        b.mark_pushed();
        assert_ne!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn fingerprint_diverges_when_order_diverges() {
        let a = Doc::new().unwrap();
        let b = Doc::new().unwrap();
        let a1 = a.add_item(LIST_MAIN, "one").unwrap();
        let a2 = a.add_item(LIST_MAIN, "two").unwrap();
        let b1 = b.add_item(LIST_MAIN, "one").unwrap();
        let b2 = b.add_item(LIST_MAIN, "two").unwrap();

        a.move_item(&a1, LIST_MAIN, 1).unwrap();

        assert_eq!(a.live_item_ids(LIST_MAIN), vec![a2, a1]);
        assert_eq!(b.live_item_ids(LIST_MAIN), vec![b1, b2]);
        assert_ne!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn view_helpers_empty_doc() {
        let doc = Doc::new().unwrap();
        assert_eq!(doc.live_item_ids(LIST_MAIN), Vec::<String>::new());
        assert_eq!(doc.done_item_ids(), Vec::<String>::new());
        assert_eq!(doc.binned_item_ids(), Vec::<String>::new());
    }

    #[test]
    fn live_item_ids_match_movable_list_order() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let c = doc.add_item(LIST_MAIN, "c").unwrap();
        // Items in another list must not leak into now's view.
        let _h = doc.add_item(&other, "h").unwrap();
        // Done/binned items must not leak into the live view.
        doc.set_item_done(&b, true).unwrap();
        let d = doc.add_item(LIST_MAIN, "d").unwrap();
        doc.set_item_binned(&d, true).unwrap();

        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, c]);
    }

    #[test]
    fn done_item_ids_sorted_by_done_at_desc() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let first = doc.add_item(LIST_MAIN, "first").unwrap();
        let second = doc.add_item(&other, "second").unwrap();
        let third = doc.add_item(LIST_MAIN, "third").unwrap();
        doc.set_item_done(&first, true).unwrap();
        // tiny gap so the millisecond timestamps definitely differ
        std::thread::sleep(std::time::Duration::from_millis(2));
        doc.set_item_done(&second, true).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        doc.set_item_done(&third, true).unwrap();

        assert_eq!(doc.done_item_ids(), vec![third, second, first]);
    }

    #[test]
    fn binned_item_ids_sorted_by_binned_at_desc() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        doc.set_item_binned(&a, true).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        doc.set_item_binned(&b, true).unwrap();
        assert_eq!(doc.binned_item_ids(), vec![b, a]);
    }

    #[test]
    fn deleted_list_orphans_appear_under_now() {
        let doc = Doc::new().unwrap();
        let mylist = doc.add_list("Errands").unwrap();
        let id = doc.add_item(&mylist, "x").unwrap();
        doc.delete_list(&mylist).unwrap();
        // The user's view of the deleted list has been reassigned: the
        // item now appears under `now`'s live view, and the deleted
        // list's live view is empty.
        assert!(doc.live_item_ids(&mylist).is_empty());
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![id]);
    }

    #[test]
    fn json_export_includes_builtin_and_user_lists() {
        let doc = Doc::new().unwrap();
        let errands = doc.add_list("Errands").unwrap();

        let export = doc.export_json();

        assert_eq!(export.version, 1);
        assert_eq!(
            export.lists[0],
            ExportList {
                id: LIST_MAIN.to_string(),
                name: LIST_MAIN_NAME.to_string(),
                created_at: None,
                builtin: true,
            }
        );
        assert_eq!(export.lists[1].id, errands);
        assert_eq!(export.lists[1].name, "Errands");
        assert_eq!(export.lists[1].builtin, false);
        assert!(export.lists[1].created_at.is_some());
    }

    #[test]
    fn json_export_includes_notes_and_status_timestamps() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "buy milk").unwrap();
        doc.edit_item_notes(&id, "whole milk").unwrap();
        doc.set_item_done(&id, true).unwrap();
        doc.set_item_binned(&id, true).unwrap();

        let export = doc.export_json();
        let item = export.items.iter().find(|item| item.id == id).unwrap();

        assert_eq!(item.text, "buy milk");
        assert_eq!(item.notes, "whole milk");
        assert_eq!(item.list_id, LIST_MAIN);
        assert!(item.done_at.is_some());
        assert!(item.binned_at.is_some());
    }

    #[test]
    fn move_live_item_uses_visible_target_index() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let hidden = doc.add_item(&other, "hidden").unwrap();
        doc.set_item_done(&hidden, true).unwrap();
        let anchor = doc.add_item(&other, "anchor").unwrap();
        let moved = doc.add_item(LIST_MAIN, "moved").unwrap();

        doc.move_item(&moved, &other, 1).unwrap();

        assert_eq!(doc.live_item_ids(&other), vec![anchor, moved]);
    }

    #[test]
    fn get_list_meta_returns_view() {
        let doc = Doc::new().unwrap();
        // Main has no MovableList entry, so no metadata in the doc —
        // clients render its label themselves.
        assert!(doc.get_list_meta(LIST_MAIN).is_none());
        assert!(doc.get_list_meta("nope").is_none());
    }

    #[test]
    fn apply_remote_rejects_wrong_dek() {
        let dek1 = Dek::generate();
        let dek2 = Dek::generate();
        let a = Doc::new().unwrap();
        let _ = a.add_item(LIST_MAIN, "x").unwrap();
        let blob = a.pending_export(&dek1).unwrap().unwrap();

        let mut b = Doc::empty();
        let err = b.apply_remote(&dek2, &blob).unwrap_err();
        assert!(matches!(err, DocError::Crypto(_)));
    }

    // ---------- AppEvent tests ----------

    #[test]
    fn local_add_item_emits_item_added() {
        let doc = Doc::new().unwrap();
        // Drain any seed events from Doc::new (currently none — seeds
        // happen before the queue is observable from outside, but
        // future-proof the test against that changing).
        let _ = doc.drain_events();
        let id = doc.add_item(LIST_MAIN, "milk").unwrap();
        let evs = doc.drain_events();
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AppEvent::ItemAdded {
                id: eid,
                list_id,
                text,
                done_at,
                binned_at,
                index,
                ..
            } => {
                assert_eq!(eid, &id);
                assert_eq!(list_id, LIST_MAIN);
                assert_eq!(text, "milk");
                assert!(done_at.is_none());
                assert!(binned_at.is_none());
                assert_eq!(*index, 0);
            }
            other => panic!("expected ItemAdded, got {other:?}"),
        }
    }

    #[test]
    fn local_edit_text_emits_text_changed() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "old").unwrap();
        let _ = doc.drain_events();
        doc.edit_item_text(&id, "new").unwrap();
        let evs = doc.drain_events();
        assert!(matches!(
            evs.as_slice(),
            [AppEvent::ItemTextChanged { id: eid, text }] if eid == &id && text == "new"
        ));
    }

    #[test]
    fn local_set_done_emits_status_changed_with_timestamps() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "task").unwrap();
        let _ = doc.drain_events();
        doc.set_item_done(&id, true).unwrap();
        let evs = doc.drain_events();
        match evs.as_slice() {
            [AppEvent::ItemStatusChanged {
                id: eid,
                done_at,
                binned_at,
            }] => {
                assert_eq!(eid, &id);
                assert!(done_at.is_some());
                assert!(binned_at.is_none());
            }
            other => panic!("unexpected events: {other:?}"),
        }
    }

    #[test]
    fn local_set_binned_preserves_done_in_event() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "task").unwrap();
        doc.set_item_done(&id, true).unwrap();
        let _ = doc.drain_events();
        doc.set_item_binned(&id, true).unwrap();
        let evs = doc.drain_events();
        match evs.as_slice() {
            [AppEvent::ItemStatusChanged {
                id: eid,
                done_at,
                binned_at,
            }] => {
                assert_eq!(eid, &id);
                assert!(done_at.is_some(), "done state must be preserved");
                assert!(binned_at.is_some());
            }
            other => panic!("unexpected events: {other:?}"),
        }
    }

    #[test]
    fn local_delete_list_emits_reassign_then_remove() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let id = doc.add_item(&other, "in other").unwrap();
        let _ = doc.drain_events();
        doc.delete_list(&other).unwrap();
        let evs = doc.drain_events();
        // ItemListChanged for the orphan, then ListRemoved.
        let mut saw_reassign = false;
        let mut saw_removed = false;
        for ev in &evs {
            match ev {
                AppEvent::ItemListChanged { id: eid, list_id } => {
                    assert_eq!(eid, &id);
                    assert_eq!(list_id, LIST_MAIN);
                    saw_reassign = true;
                }
                AppEvent::ListRemoved { id: lid } => {
                    assert_eq!(lid, &other);
                    saw_removed = true;
                }
                _ => {}
            }
        }
        assert!(saw_reassign && saw_removed, "events: {evs:?}");
    }

    #[test]
    fn apply_remote_emits_item_added_for_peer_inserts() {
        let dek = Dek::generate();
        let a = Doc::new().unwrap();
        let item_id = a.add_item(LIST_MAIN, "from peer").unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();

        let mut b = Doc::empty();
        let _ = b.drain_events();
        b.apply_remote(&dek, &blob).unwrap();
        let evs = b.drain_events();

        // Should include ItemAdded for the peer item. Main has no
        // MovableList entry, so no ListAdded is emitted for it.
        assert!(
            !evs.iter()
                .any(|e| matches!(e, AppEvent::ListAdded { id, .. } if id == LIST_MAIN)),
            "main is virtual; no ListAdded should be emitted: {evs:?}"
        );
        assert!(
            evs.iter()
                .any(|e| matches!(e, AppEvent::ItemAdded { id, .. } if id == &item_id)),
            "expected ItemAdded for peer item: {evs:?}"
        );
    }

    #[test]
    fn apply_remote_emits_text_changed_for_peer_edits() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let id = a.add_item(LIST_MAIN, "old").unwrap();
        let setup_blob = a.pending_export(&dek).unwrap().unwrap();
        a.mark_pushed();

        let mut b = Doc::empty();
        b.apply_remote(&dek, &setup_blob).unwrap();
        let _ = b.drain_events();

        a.edit_item_text(&id, "new").unwrap();
        let edit_blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &edit_blob).unwrap();
        let evs = b.drain_events();
        assert!(
            evs.iter()
                .any(|e| matches!(e, AppEvent::ItemTextChanged { id: eid, text } if eid == &id && text == "new")),
            "expected ItemTextChanged in {evs:?}"
        );
    }

    #[test]
    fn apply_remote_batch_emits_final_state_once_for_multi_blob_catchup() {
        let dek = Dek::generate();
        let mut src = Doc::new().unwrap();
        let id = src.add_item(LIST_MAIN, "old").unwrap();
        let setup_blob = src.pending_export(&dek).unwrap().unwrap();
        src.mark_pushed();

        src.edit_item_text(&id, "new").unwrap();
        let edit_blob = src.pending_export(&dek).unwrap().unwrap();

        let mut dst = Doc::empty();
        let _ = dst.drain_events();
        dst.apply_remote_batch(&dek, [&setup_blob, &edit_blob])
            .unwrap();
        let evs = dst.drain_events();

        assert!(
            evs.iter().any(
                |e| matches!(e, AppEvent::ItemAdded { id: eid, text, .. } if eid == &id && text == "new")
            ),
            "expected final ItemAdded for {id} in {evs:?}"
        );
        assert!(
            !evs.iter()
                .any(|e| matches!(e, AppEvent::ItemTextChanged { id: eid, .. } if eid == &id)),
            "batch catch-up should emit final-state delta, not intermediate edit churn: {evs:?}"
        );
        assert_eq!(dst.fingerprint(), src.fingerprint());
    }

    #[test]
    fn add_item_at_inserts_at_target_position() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let c = doc.add_item(LIST_MAIN, "c").unwrap();
        let mid = doc.add_item_at(LIST_MAIN, "mid", 1).unwrap();
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, mid, b, c]);
    }

    #[test]
    fn add_item_at_appends_when_target_past_end() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item_at(LIST_MAIN, "b", 99).unwrap();
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, b]);
    }

    #[test]
    fn add_item_at_skips_other_lists_and_non_live_when_counting() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let _hidden = doc.add_item(&other, "hidden").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let done = doc.add_item(LIST_MAIN, "done").unwrap();
        doc.set_item_done(&done, true).unwrap();
        // Position 1 in main's live view should land between a and b
        // regardless of the other-list and done items in between.
        let mid = doc.add_item_at(LIST_MAIN, "mid", 1).unwrap();
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, mid, b]);
    }

    #[test]
    fn add_item_at_emits_item_added_with_absolute_index() {
        let doc = Doc::new().unwrap();
        let _a = doc.add_item(LIST_MAIN, "a").unwrap();
        let _b = doc.add_item(LIST_MAIN, "b").unwrap();
        let _ = doc.drain_events();
        let mid = doc.add_item_at(LIST_MAIN, "mid", 1).unwrap();
        let evs = doc.drain_events();
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AppEvent::ItemAdded { id, index, .. } => {
                assert_eq!(id, &mid);
                assert_eq!(*index, 1);
            }
            other => panic!("expected ItemAdded, got {other:?}"),
        }
    }

    #[test]
    fn local_move_item_emits_destination_absolute_index() {
        let doc = Doc::new().unwrap();
        let first = doc.add_item(LIST_MAIN, "first").unwrap();
        let moved = doc.add_item(LIST_MAIN, "moved").unwrap();
        let third = doc.add_item(LIST_MAIN, "third").unwrap();
        let _ = doc.drain_events();

        doc.move_item(&moved, LIST_MAIN, 0).unwrap();

        assert_eq!(
            doc.live_item_ids(LIST_MAIN),
            vec![moved.clone(), first, third]
        );
        let evs = doc.drain_events();
        assert!(
            evs.iter().any(
                |e| matches!(e, AppEvent::ItemMoved { id, index } if id == &moved && *index == 0)
            ),
            "expected ItemMoved to absolute index 0, got {evs:?}"
        );
    }

    #[test]
    fn set_items_binned_updates_many_in_one_call() {
        let doc = Doc::new().unwrap();
        let first = doc.add_item(LIST_MAIN, "first").unwrap();
        let second = doc.add_item(LIST_MAIN, "second").unwrap();

        doc.set_items_binned(&[first.as_str(), second.as_str()], true)
            .unwrap();

        assert_eq!(doc.live_item_ids(LIST_MAIN), Vec::<String>::new());
        assert_eq!(doc.binned_item_ids().len(), 2);
    }

    #[test]
    fn delete_binned_items_removes_many_in_one_call() {
        let doc = Doc::new().unwrap();
        let keep = doc.add_item(LIST_MAIN, "keep").unwrap();
        let first = doc.add_item(LIST_MAIN, "first").unwrap();
        let second = doc.add_item(LIST_MAIN, "second").unwrap();
        doc.set_items_binned(&[first.as_str(), second.as_str()], true)
            .unwrap();

        doc.delete_binned_items(&[first.as_str(), second.as_str()])
            .unwrap();

        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![keep]);
        assert_eq!(doc.binned_item_ids(), Vec::<String>::new());
    }

    #[test]
    fn add_item_at_rejects_empty_text() {
        let doc = Doc::new().unwrap();
        let err = doc.add_item_at(LIST_MAIN, "  ", 0).unwrap_err();
        assert!(matches!(err, DocError::Invalid(_)));
    }

    #[test]
    fn add_items_at_inserts_in_order() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let ids = doc.add_items_at(LIST_MAIN, &["x", "y", "z"], 1).unwrap();
        assert_eq!(ids.len(), 3);
        assert_eq!(
            doc.live_item_ids(LIST_MAIN),
            vec![a, ids[0].clone(), ids[1].clone(), ids[2].clone(), b],
        );
    }

    #[test]
    fn add_items_at_appends_when_target_past_end() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let ids = doc.add_items_at(LIST_MAIN, &["x", "y"], 99).unwrap();
        assert_eq!(
            doc.live_item_ids(LIST_MAIN),
            vec![a, ids[0].clone(), ids[1].clone()]
        );
    }

    #[test]
    fn add_items_at_emits_one_event_per_item_with_increasing_indices() {
        let doc = Doc::new().unwrap();
        let _a = doc.add_item(LIST_MAIN, "a").unwrap();
        let _b = doc.add_item(LIST_MAIN, "b").unwrap();
        let _ = doc.drain_events();
        let ids = doc.add_items_at(LIST_MAIN, &["x", "y"], 1).unwrap();
        let evs = doc.drain_events();
        let added: Vec<(String, usize)> = evs
            .iter()
            .filter_map(|e| match e {
                AppEvent::ItemAdded { id, index, .. } => Some((id.clone(), *index)),
                _ => None,
            })
            .collect();
        assert_eq!(added.len(), 2);
        assert_eq!(added[0], (ids[0].clone(), 1));
        assert_eq!(added[1], (ids[1].clone(), 2));
    }

    #[test]
    fn add_items_at_rejects_batch_atomically_on_empty_text() {
        let doc = Doc::new().unwrap();
        let _a = doc.add_item(LIST_MAIN, "a").unwrap();
        let _ = doc.drain_events();
        let err = doc
            .add_items_at(LIST_MAIN, &["ok", "  ", "also ok"], 0)
            .unwrap_err();
        assert!(matches!(err, DocError::Invalid(_)));
        // Nothing landed.
        assert_eq!(doc.live_item_ids(LIST_MAIN).len(), 1);
        assert!(doc.drain_events().is_empty());
    }

    #[test]
    fn add_items_at_empty_input_is_a_noop() {
        let doc = Doc::new().unwrap();
        let _ = doc.drain_events();
        let ids = doc.add_items_at(LIST_MAIN, &[], 0).unwrap();
        assert!(ids.is_empty());
        assert!(doc.drain_events().is_empty());
    }

    #[test]
    fn snapshot_events_materializes_current_state() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(&other, "b").unwrap();
        let _ = doc.drain_events();

        let snap = doc.snapshot_events();
        // ListAdded events come first, then ItemAdded events.
        let lists: Vec<&str> = snap
            .iter()
            .filter_map(|e| match e {
                AppEvent::ListAdded { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        let items: Vec<&str> = snap
            .iter()
            .filter_map(|e| match e {
                AppEvent::ItemAdded { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        // Main is virtual; no ListAdded is emitted for it.
        assert!(!lists.contains(&LIST_MAIN));
        assert!(lists.contains(&other.as_str()));
        assert!(items.contains(&a.as_str()));
        assert!(items.contains(&b.as_str()));
    }

    #[test]
    fn export_json_string_is_valid_pretty_json() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let _ = doc.add_item(LIST_MAIN, "a").unwrap();
        let _ = doc.add_item(&other, "b").unwrap();

        let s = doc.export_json_string();
        // Pretty form has at least one newline; validates that the
        // method went through `to_string_pretty`, not a compact dump.
        assert!(s.contains('\n'));
        // Round-trips through serde_json into the same struct.
        let parsed: JsonExport = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed, doc.export_json());
    }

    #[test]
    fn export_snapshot_bytes_roundtrips_through_loro_import() {
        // Backup story: bytes from `export_snapshot_bytes` reconstruct
        // the same logical state when imported into a fresh Loro doc.
        // (`Doc::load` takes the full msgpack envelope; the user-facing
        // backup is just the snapshot half, so we go through `LoroDoc`
        // directly here — same path a fresh client would take to ingest
        // an `airday-*.bin`.)
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let _ = doc.add_item(&other, "b").unwrap();
        doc.set_item_done(&a, true).unwrap();

        let bytes = doc.export_snapshot_bytes().unwrap();
        assert!(!bytes.is_empty());

        let restored_inner = LoroDoc::new();
        restored_inner.import(&bytes).unwrap();
        let undo = Mutex::new(make_undo_manager(&restored_inner));
        let restored = Doc {
            inner: restored_inner,
            last_pushed_vv: VersionVector::default(),
            events: Mutex::new(VecDeque::new()),
            undo,
        };

        // Fingerprint is the canonical "logical-equality" hash used
        // throughout the test suite to assert convergence — same hash
        // ⇒ same doc.
        assert_eq!(doc.fingerprint(), restored.fingerprint());
    }

    #[test]
    fn fresh_doc_cannot_undo_seed() {
        // Seed runs before the UndoManager is created, so it isn't on
        // the stack — the doc opens with nothing to undo.
        let doc = Doc::new().unwrap();
        assert!(!doc.can_undo());
        assert!(!doc.can_redo());
        assert!(!doc.undo().unwrap());
    }

    #[test]
    fn undo_reverses_local_add_and_redo_replays_it() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "buy milk").unwrap();
        assert!(doc.can_undo());

        assert!(doc.undo().unwrap());
        assert!(doc.get_item(&id).is_none());
        assert!(doc.can_redo());

        assert!(doc.redo().unwrap());
        let view = doc.get_item(&id).unwrap();
        assert_eq!(view.text, "buy milk");
    }

    #[test]
    fn undo_emits_app_events() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "thing").unwrap();
        let _ = doc.drain_events();

        assert!(doc.undo().unwrap());
        let evs = doc.drain_events();
        assert!(
            evs.iter()
                .any(|e| matches!(e, AppEvent::ItemRemoved { id: i, .. } if i == &id)),
            "expected an ItemRemoved event for the undone add, got {evs:?}"
        );
    }

    #[test]
    fn plain_stepwise_undo_redo_round_trips_larger_reorder() {
        let doc = Doc::new().unwrap();
        let texts: Vec<String> = (0..20).map(|i| format!("item {i}")).collect();
        let text_refs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
        let ids = doc.add_items_at(LIST_MAIN, &text_refs, 0).unwrap();

        let moved_ids = vec![ids[5].clone(), ids[6].clone(), ids[7].clone()];
        let remaining: Vec<String> = ids
            .iter()
            .filter(|id| !moved_ids.contains(id))
            .cloned()
            .collect();
        let mut next_ids = remaining;
        next_ids.splice(10..10, moved_ids.clone());
        let mut current_ids = ids.clone();
        let mut steps = 0usize;

        for (index, id) in next_ids.iter().enumerate() {
            if current_ids[index] != *id {
                let current_index = current_ids
                    .iter()
                    .position(|cur| cur == id)
                    .expect("moved id must still exist");
                doc.move_item(id, LIST_MAIN, index).unwrap();
                current_ids.remove(current_index);
                current_ids.insert(index, id.clone());
                steps += 1;
            }
        }

        let after_move = doc.live_item_ids(LIST_MAIN);
        assert_eq!(after_move, next_ids);

        for _ in 0..steps {
            assert!(doc.undo().unwrap());
        }
        assert_eq!(doc.live_item_ids(LIST_MAIN), ids);

        for _ in 0..steps {
            assert!(doc.redo().unwrap());
        }
        assert_eq!(doc.live_item_ids(LIST_MAIN), after_move);
    }

    #[test]
    fn undo_skips_remote_ops() {
        // Remote ops imported via `apply_remote` carry origin "remote"
        // and must not be undoable from the local UndoManager. Local
        // mutations made on top of remote state remain undoable.
        let dek = Dek::generate();

        let mut a = Doc::new().unwrap();
        let remote_id = a.add_item(LIST_MAIN, "from A").unwrap();
        let remote_blob = a.pending_export(&dek).unwrap().unwrap();
        a.mark_pushed();

        let mut b = Doc::empty();
        b.apply_remote(&dek, &remote_blob).unwrap();
        // One remote import landed but b has made no local commits.
        assert!(!b.can_undo(), "remote-only ops must not be undoable");

        let local_id = b.add_item(LIST_MAIN, "local on top").unwrap();
        assert!(b.can_undo());

        assert!(b.undo().unwrap());
        assert!(
            b.get_item(&local_id).is_none(),
            "local add should be reversed"
        );
        assert!(
            b.get_item(&remote_id).is_some(),
            "remote item must survive the local undo"
        );
        assert!(
            !b.can_undo(),
            "remote ops still must not be undoable after local undo"
        );
    }
}
