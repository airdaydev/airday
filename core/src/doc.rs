//! Loro CRDT layer: typed mutations, persistence, op-stream framing,
//! and a deterministic logical-state fingerprint.
//!
//! Layout matches `spec/data-model.md`:
//! - root container `items` (`LoroMovableList`) — each entry is a
//!   `LoroMap` with `id`, `text`, `list_id`, `status`, `created_at`,
//!   optional `done_at`, optional `binned_at`.
//! - root container `lists` (`LoroMovableList`) — each entry is a
//!   `LoroMap` with `id`, `name`, `created_at`.
//!
//! The bin is *not* a list — `Status::Binned` items keep their
//! `list_id`. One well-known list id is seeded on init: [`LIST_MAIN`].
//! A second "Later" list is seeded with a fresh uuid so it behaves like
//! any user-created list (rename, delete, etc.).
//!
//! The struct holds a `last_pushed_vv` so we can hand the sync engine
//! "what's new since the last server interaction" as a single sealed
//! blob without re-shipping ops we already saw.

#[cfg(not(target_arch = "wasm32"))]
use std::time::{SystemTime, UNIX_EPOCH};

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use loro::{
    Container, ExportMode, LoroDoc, LoroMap, LoroMovableList, ValueOrContainer, VersionVector,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::crypto::{Dek, AEAD_NONCE_LEN};
use crate::events::AppEvent;
use airday_protocol::EncryptedBlob;

pub const LIST_MAIN: &str = "main";

const ROOT_ITEMS: &str = "items";
const ROOT_LISTS: &str = "lists";

const KEY_ID: &str = "id";
const KEY_TEXT: &str = "text";
const KEY_LIST_ID: &str = "list_id";
const KEY_STATUS: &str = "status";
const KEY_NAME: &str = "name";
const KEY_CREATED_AT: &str = "created_at";
const KEY_DONE_AT: &str = "done_at";
const KEY_BINNED_AT: &str = "binned_at";

const STATUS_LIVE: &str = "live";
const STATUS_DONE: &str = "done";
const STATUS_BINNED: &str = "binned";

/// Item lifecycle. `Live` is the default; `Done` and `Binned` carry a
/// timestamp; deletion of `Binned` items is the only path that
/// removes an item from the doc.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Live,
    Done,
    Binned,
}

impl Status {
    fn as_wire(&self) -> &'static str {
        match self {
            Status::Live => STATUS_LIVE,
            Status::Done => STATUS_DONE,
            Status::Binned => STATUS_BINNED,
        }
    }

    fn from_wire(s: &str) -> Option<Self> {
        match s {
            STATUS_LIVE => Some(Status::Live),
            STATUS_DONE => Some(Status::Done),
            STATUS_BINNED => Some(Status::Binned),
            _ => None,
        }
    }
}

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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemView {
    pub id: String,
    pub text: String,
    pub list_id: String,
    pub status: Status,
    pub created_at: i64,
    pub done_at: Option<i64>,
    pub binned_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListView {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

pub struct Doc {
    inner: LoroDoc,
    last_pushed_vv: VersionVector,
    /// Domain-level change events. Mutation methods push directly;
    /// `apply_remote` does state-diff and pushes a batch. Drain via
    /// `pop_event` / `drain_events`. Wrapped in `Mutex` so mutation
    /// methods can stay `&self` (Loro's interior-mutability shape).
    events: Mutex<VecDeque<AppEvent>>,
}

impl Doc {
    /// New doc with built-in lists seeded. The seed is *not* marked as
    /// pushed — the first `pending_export` includes it, so peers
    /// joining via the op stream see the built-ins. Device-2 bootstrap
    /// via snapshot bypasses this path entirely.
    pub fn new() -> Result<Self, DocError> {
        let inner = LoroDoc::new();
        seed_builtins(&inner)?;
        inner.commit();
        Ok(Self {
            inner,
            last_pushed_vv: VersionVector::default(),
            events: Mutex::new(VecDeque::new()),
        })
    }

    /// Empty doc — used by device 2 before snapshot import.
    pub fn empty() -> Self {
        let inner = LoroDoc::new();
        Self {
            last_pushed_vv: inner.oplog_vv(),
            inner,
            events: Mutex::new(VecDeque::new()),
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
        map.insert(KEY_STATUS, STATUS_LIVE)?;
        map.insert(KEY_CREATED_AT, now)?;
        self.inner.commit();
        let index = items.len().saturating_sub(1);
        self.push_event(AppEvent::ItemAdded {
            id: id.clone(),
            list_id: list_id.to_string(),
            text: text.to_string(),
            status: Status::Live,
            created_at: now,
            done_at: None,
            binned_at: None,
            index,
        });
        Ok(id)
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

    pub fn move_item(
        &self,
        item_id: &str,
        target_list_id: &str,
        target_index: usize,
    ) -> Result<(), DocError> {
        self.assert_list_exists(target_list_id)?;
        let (idx, map) = self.find_item(item_id)?;
        let moving_status = read_status(&map)
            .ok_or_else(|| DocError::Invalid(format!("item `{item_id}` is missing status")))?;
        let prev_list_id = read_string(&map, KEY_LIST_ID);
        let items = self.items();
        // `target_index` is the desired index *within target_list_id*;
        // map it onto an absolute index in the global items list by
        // counting matching entries up to that point. Sprint 1 cap is
        // 4096 items so the linear scan is fine.
        let abs =
            absolute_index_for_list_position(&items, target_list_id, target_index, idx, moving_status);
        map.insert(KEY_LIST_ID, target_list_id)?;
        if abs != idx {
            items.mov(idx, abs)?;
        }
        self.inner.commit();
        if prev_list_id.as_deref() != Some(target_list_id) {
            self.push_event(AppEvent::ItemListChanged {
                id: item_id.to_string(),
                list_id: target_list_id.to_string(),
            });
        }
        if abs != idx {
            self.push_event(AppEvent::ItemMoved {
                id: item_id.to_string(),
                index: abs,
            });
        }
        Ok(())
    }

    pub fn set_item_status(&self, item_id: &str, status: Status) -> Result<(), DocError> {
        let (_, map) = self.find_item(item_id)?;
        let now = now_millis();
        map.insert(KEY_STATUS, status.as_wire())?;
        let (done_at, binned_at) = match status {
            Status::Live => {
                let _ = map.delete(KEY_DONE_AT);
                let _ = map.delete(KEY_BINNED_AT);
                (None, None)
            }
            Status::Done => {
                map.insert(KEY_DONE_AT, now)?;
                let _ = map.delete(KEY_BINNED_AT);
                (Some(now), None)
            }
            Status::Binned => {
                map.insert(KEY_BINNED_AT, now)?;
                let _ = map.delete(KEY_DONE_AT);
                (None, Some(now))
            }
        };
        self.inner.commit();
        self.push_event(AppEvent::ItemStatusChanged {
            id: item_id.to_string(),
            status,
            done_at,
            binned_at,
        });
        Ok(())
    }

    pub fn delete_binned(&self, item_id: &str) -> Result<(), DocError> {
        let (idx, map) = self.find_item(item_id)?;
        if read_status(&map) != Some(Status::Binned) {
            return Err(DocError::NotBinned);
        }
        self.items().delete(idx, 1)?;
        self.inner.commit();
        self.push_event(AppEvent::ItemRemoved {
            id: item_id.to_string(),
        });
        Ok(())
    }

    /// Hard-deletes every item with `Status::Binned`. Walks back-to-front
    /// so deletions don't shift indices we haven't visited yet.
    pub fn empty_bin(&self) -> Result<usize, DocError> {
        let items = self.items();
        let mut removed_ids = Vec::new();
        for idx in (0..items.len()).rev() {
            let Some(map) = item_map_at(&items, idx) else {
                continue;
            };
            if read_status(&map) == Some(Status::Binned) {
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
        let index = lists.len().saturating_sub(1);
        self.push_event(AppEvent::ListAdded {
            id: id.clone(),
            name: name.to_string(),
            created_at: now,
            index,
        });
        Ok(id)
    }

    pub fn rename_list(&self, list_id: &str, name: &str) -> Result<(), DocError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DocError::Invalid("list name is empty".into()));
        }
        let (_, map) = self.find_list(list_id)?;
        map.insert(KEY_NAME, name)?;
        self.inner.commit();
        self.push_event(AppEvent::ListRenamed {
            id: list_id.to_string(),
            name: name.to_string(),
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
            .filter(|i| i.list_id == list_id && (include_binned || i.status != Status::Binned))
            .collect()
    }

    pub fn binned_items(&self) -> Vec<ItemView> {
        self.iter_items()
            .filter(|i| i.status == Status::Binned)
            .collect()
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

    pub fn get_item(&self, item_id: &str) -> Option<ItemView> {
        let (_, map) = self.find_item(item_id).ok()?;
        item_view(&map)
    }

    pub fn get_list_meta(&self, list_id: &str) -> Option<ListView> {
        let (_, map) = self.find_list(list_id).ok()?;
        list_view(&map)
    }

    /// Per-list nav view: ids of `Live` items in this list, in
    /// MovableList order. Items whose `list_id` no longer exists
    /// (orphaned by `delete_list`'s reassignment to `now`) won't
    /// appear here for the deleted id by definition — they're now
    /// under `now`.
    pub fn live_item_ids(&self, list_id: &str) -> Vec<String> {
        self.iter_items()
            .filter(|i| i.list_id == list_id && i.status == Status::Live)
            .map(|i| i.id)
            .collect()
    }

    /// Cross-list "Done" view: ids sorted by `done_at` descending.
    /// Ties broken by id ascending so the order is deterministic across
    /// devices despite client-clock skew.
    pub fn done_item_ids(&self) -> Vec<String> {
        let mut items: Vec<ItemView> = self
            .iter_items()
            .filter(|i| i.status == Status::Done)
            .collect();
        items.sort_by(|a, b| {
            let at = a.done_at.unwrap_or(0);
            let bt = b.done_at.unwrap_or(0);
            bt.cmp(&at).then_with(|| a.id.cmp(&b.id))
        });
        items.into_iter().map(|i| i.id).collect()
    }

    /// Cross-list "Bin" view: ids sorted by `binned_at` descending.
    /// Same tiebreaker as `done_item_ids`.
    pub fn binned_item_ids(&self) -> Vec<String> {
        let mut items: Vec<ItemView> = self
            .iter_items()
            .filter(|i| i.status == Status::Binned)
            .collect();
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
        if blob.nonce.len() != AEAD_NONCE_LEN {
            return Err(DocError::Invalid(format!(
                "expected {AEAD_NONCE_LEN}-byte nonce, got {}",
                blob.nonce.len()
            )));
        }
        let pre_items: Vec<ItemView> = self.iter_items().collect();
        let pre_lists: Vec<ListView> = self.all_lists();
        let plaintext = dek.open(&blob.ciphertext, &blob.nonce)?;
        let status = self.inner.import(&plaintext)?;
        // VersionRange is `(start, end)` per peer — `end` is the
        // exclusive upper bound, which matches `VersionVector`'s
        // counter semantics (cf. loro `VersionRange::from_vv`).
        let mut imported_vv = VersionVector::new();
        for (peer, (_, end)) in status.success.iter() {
            imported_vv.insert(*peer, *end);
        }
        self.last_pushed_vv.merge(&imported_vv);
        let post_items: Vec<ItemView> = self.iter_items().collect();
        let post_lists: Vec<ListView> = self.all_lists();
        let mut emitted = Vec::new();
        diff_lists(&pre_lists, &post_lists, &mut emitted);
        diff_items(&pre_items, &post_items, &mut emitted);
        if !emitted.is_empty() {
            let mut q = self.events.lock().expect("events mutex poisoned");
            for ev in emitted {
                q.push_back(ev);
            }
        }
        Ok(())
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
                status: item.status,
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
        Ok(Self {
            inner,
            last_pushed_vv,
            events: Mutex::new(VecDeque::new()),
        })
    }

    // ---------- fingerprint ----------

    /// Logical-state hash. Stable across replicas at logical equality;
    /// used for convergence assertions in tests. Snapshot bytes are
    /// *not* stable (Loro stores per-replica metadata), so we hash a
    /// canonical serialization of the visible item / list state.
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        // Lists: walk by stored order (the user-visible order), feed
        // a length-prefixed canonical encoding of each list.
        let mut lists = self.all_lists();
        lists.sort_by(|a, b| a.id.cmp(&b.id));
        hasher.update(b"L");
        hasher.update((lists.len() as u32).to_be_bytes());
        for l in &lists {
            hash_str(&mut hasher, &l.id);
            hash_str(&mut hasher, &l.name);
            hasher.update(l.created_at.to_be_bytes());
        }
        // Items: sort by id for determinism — Loro's MovableList
        // ordering can converge to logically-equal-but-physically-
        // different positions across replicas mid-merge, but ids are
        // stable.
        let mut items: Vec<ItemView> = self.iter_items().collect();
        items.sort_by(|a, b| a.id.cmp(&b.id));
        hasher.update(b"I");
        hasher.update((items.len() as u32).to_be_bytes());
        for i in &items {
            hash_str(&mut hasher, &i.id);
            hash_str(&mut hasher, &i.text);
            hash_str(&mut hasher, &i.list_id);
            hash_str(&mut hasher, i.status.as_wire());
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

    fn assert_list_exists(&self, list_id: &str) -> Result<(), DocError> {
        self.find_list(list_id).map(|_| ())
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

fn seed_builtins(doc: &LoroDoc) -> Result<(), DocError> {
    let lists = doc.get_movable_list(ROOT_LISTS);
    let now_ts = now_millis();
    // The "main" list is the always-on built-in — stable id so
    // delete_list can refuse it and orphans can be reassigned. "Now"
    // is the starting display label; users can rename it. "Later" is
    // just a pre-seeded user list: fresh uuid, deletable like any
    // other.
    let later_id = new_id();
    for (id, name) in [(LIST_MAIN, "Now"), (later_id.as_str(), "Later")] {
        let map = lists.push_container(LoroMap::new())?;
        map.insert(KEY_ID, id)?;
        map.insert(KEY_NAME, name)?;
        map.insert(KEY_CREATED_AT, now_ts)?;
    }
    Ok(())
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

fn read_status(map: &LoroMap) -> Option<Status> {
    Status::from_wire(&read_string(map, KEY_STATUS)?)
}

fn item_view(map: &LoroMap) -> Option<ItemView> {
    Some(ItemView {
        id: read_string(map, KEY_ID)?,
        text: read_string(map, KEY_TEXT)?,
        list_id: read_string(map, KEY_LIST_ID)?,
        status: read_status(map)?,
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

/// Walk the items list and translate "the Nth entry in `target_list`"
/// into the corresponding absolute index. `current_idx` is excluded
/// from the count so move-to-current-position is a no-op rather than
/// off-by-one.
fn absolute_index_for_list_position(
    items: &LoroMovableList,
    target_list_id: &str,
    target_index: usize,
    current_idx: usize,
    moving_status: Status,
) -> usize {
    let mut seen = 0usize;
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
        // Live-list reorders originate from the visible per-list view,
        // so hidden done/binned items must not consume target slots.
        if moving_status == Status::Live && read_status(&map) != Some(Status::Live) {
            continue;
        }
        if seen == target_index {
            return i;
        }
        seen += 1;
    }
    items.len().saturating_sub(1)
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
                    status: post_it.status,
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
                if pre_it.status != post_it.status
                    || pre_it.done_at != post_it.done_at
                    || pre_it.binned_at != post_it.binned_at
                {
                    out.push(AppEvent::ItemStatusChanged {
                        id: post_it.id.clone(),
                        status: post_it.status,
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
    fn new_doc_has_builtin_lists() {
        let doc = Doc::new().unwrap();
        let lists = doc.all_lists();
        let names: Vec<_> = lists.iter().map(|l| l.name.as_str()).collect();
        assert!(lists.iter().any(|l| l.id == LIST_MAIN));
        assert!(names.contains(&"Now"));
        assert!(names.contains(&"Later"));
    }

    #[test]
    fn add_item_round_trips_through_get() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "buy milk").unwrap();
        let view = doc.get_item(&id).unwrap();
        assert_eq!(view.text, "buy milk");
        assert_eq!(view.list_id, LIST_MAIN);
        assert_eq!(view.status, Status::Live);
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
    fn status_transitions_clear_other_timestamps() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "thing").unwrap();
        doc.set_item_status(&id, Status::Done).unwrap();
        assert!(doc.get_item(&id).unwrap().done_at.is_some());
        doc.set_item_status(&id, Status::Binned).unwrap();
        let v = doc.get_item(&id).unwrap();
        assert_eq!(v.status, Status::Binned);
        assert!(v.binned_at.is_some());
        assert!(v.done_at.is_none());
        doc.set_item_status(&id, Status::Live).unwrap();
        let v = doc.get_item(&id).unwrap();
        assert!(v.done_at.is_none());
        assert!(v.binned_at.is_none());
    }

    #[test]
    fn empty_bin_removes_only_binned() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "keep").unwrap();
        let b = doc.add_item(LIST_MAIN, "drop").unwrap();
        doc.set_item_status(&b, Status::Binned).unwrap();
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
        doc.set_item_status(&id, Status::Binned).unwrap();
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

        // Replica A is the originator: seeded built-ins, plus one item.
        let mut a = Doc::new().unwrap();
        let a_initial_blob = a
            .pending_export(&dek)
            .unwrap()
            .expect("seed counts as pending until first push");
        a.mark_pushed();

        let item_a = a.add_item(LIST_MAIN, "from A").unwrap();

        // Replica B starts empty (sprint-1 device-2 path uses snapshot,
        // but the convergence guarantee is what we're testing).
        let mut b = Doc::empty();
        b.apply_remote(&dek, &a_initial_blob).unwrap();

        // Now both have the same lists. Push A's first real op to B.
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
        doc.set_item_status(&b, Status::Done).unwrap();
        let d = doc.add_item(LIST_MAIN, "d").unwrap();
        doc.set_item_status(&d, Status::Binned).unwrap();

        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, c]);
    }

    #[test]
    fn done_item_ids_sorted_by_done_at_desc() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let first = doc.add_item(LIST_MAIN, "first").unwrap();
        let second = doc.add_item(&other, "second").unwrap();
        let third = doc.add_item(LIST_MAIN, "third").unwrap();
        doc.set_item_status(&first, Status::Done).unwrap();
        // tiny gap so the millisecond timestamps definitely differ
        std::thread::sleep(std::time::Duration::from_millis(2));
        doc.set_item_status(&second, Status::Done).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        doc.set_item_status(&third, Status::Done).unwrap();

        assert_eq!(doc.done_item_ids(), vec![third, second, first]);
    }

    #[test]
    fn binned_item_ids_sorted_by_binned_at_desc() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        doc.set_item_status(&a, Status::Binned).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(2));
        doc.set_item_status(&b, Status::Binned).unwrap();
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
    fn move_live_item_uses_visible_target_index() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let hidden = doc.add_item(&other, "hidden").unwrap();
        doc.set_item_status(&hidden, Status::Done).unwrap();
        let anchor = doc.add_item(&other, "anchor").unwrap();
        let moved = doc.add_item(LIST_MAIN, "moved").unwrap();

        doc.move_item(&moved, &other, 1).unwrap();

        assert_eq!(doc.live_item_ids(&other), vec![anchor, moved]);
    }

    #[test]
    fn get_list_meta_returns_view() {
        let doc = Doc::new().unwrap();
        let v = doc.get_list_meta(LIST_MAIN).unwrap();
        assert_eq!(v.id, LIST_MAIN);
        assert_eq!(v.name, "Now");
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
                status,
                index,
                ..
            } => {
                assert_eq!(eid, &id);
                assert_eq!(list_id, LIST_MAIN);
                assert_eq!(text, "milk");
                assert_eq!(*status, Status::Live);
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
    fn local_set_status_emits_status_changed_with_timestamps() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "task").unwrap();
        let _ = doc.drain_events();
        doc.set_item_status(&id, Status::Done).unwrap();
        let evs = doc.drain_events();
        match evs.as_slice() {
            [AppEvent::ItemStatusChanged {
                id: eid,
                status,
                done_at,
                binned_at,
            }] => {
                assert_eq!(eid, &id);
                assert_eq!(*status, Status::Done);
                assert!(done_at.is_some());
                assert!(binned_at.is_none());
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

        // Should include ListAdded for the seeded lists and ItemAdded
        // for the peer item.
        assert!(
            evs.iter()
                .any(|e| matches!(e, AppEvent::ListAdded { id, .. } if id == LIST_MAIN)),
            "expected ListAdded for `now`: {evs:?}"
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
        assert!(lists.contains(&LIST_MAIN));
        assert!(lists.contains(&other.as_str()));
        assert!(items.contains(&a.as_str()));
        assert!(items.contains(&b.as_str()));
    }
}
