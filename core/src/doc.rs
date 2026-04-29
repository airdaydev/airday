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
//! `list_id`. Two well-known list ids are seeded on init:
//! [`LIST_CURRENT`] and [`LIST_HOLDING`].
//!
//! The struct holds a `last_pushed_vv` so we can hand the sync engine
//! "what's new since the last server interaction" as a single sealed
//! blob without re-shipping ops we already saw.

#[cfg(not(target_arch = "wasm32"))]
use std::time::{SystemTime, UNIX_EPOCH};

use loro::{Container, ExportMode, LoroDoc, LoroMap, LoroMovableList, ValueOrContainer, VersionVector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::crypto::{Dek, AEAD_NONCE_LEN};
use airday_protocol::EncryptedBlob;

pub const LIST_CURRENT: &str = "current";
pub const LIST_HOLDING: &str = "holding";

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
        })
    }

    /// Empty doc — used by device 2 before snapshot import.
    pub fn empty() -> Self {
        let inner = LoroDoc::new();
        Self {
            last_pushed_vv: inner.oplog_vv(),
            inner,
        }
    }

    pub fn last_pushed_vv(&self) -> &VersionVector {
        &self.last_pushed_vv
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
        map.insert(KEY_LIST_ID, target_list_id)?;
        let items = self.items();
        // `target_index` is the desired index *within target_list_id*;
        // map it onto an absolute index in the global items list by
        // counting matching entries up to that point. Sprint 1 cap is
        // 4096 items so the linear scan is fine.
        let abs = absolute_index_for_list_position(&items, target_list_id, target_index, idx);
        if abs != idx {
            items.mov(idx, abs)?;
        }
        self.inner.commit();
        Ok(())
    }

    pub fn set_item_status(&self, item_id: &str, status: Status) -> Result<(), DocError> {
        let (_, map) = self.find_item(item_id)?;
        let now = now_millis();
        map.insert(KEY_STATUS, status.as_wire())?;
        match status {
            Status::Live => {
                let _ = map.delete(KEY_DONE_AT);
                let _ = map.delete(KEY_BINNED_AT);
            }
            Status::Done => {
                map.insert(KEY_DONE_AT, now)?;
                let _ = map.delete(KEY_BINNED_AT);
            }
            Status::Binned => {
                map.insert(KEY_BINNED_AT, now)?;
                let _ = map.delete(KEY_DONE_AT);
            }
        }
        self.inner.commit();
        Ok(())
    }

    pub fn delete_binned(&self, item_id: &str) -> Result<(), DocError> {
        let (idx, map) = self.find_item(item_id)?;
        if read_status(&map) != Some(Status::Binned) {
            return Err(DocError::NotBinned);
        }
        self.items().delete(idx, 1)?;
        self.inner.commit();
        Ok(())
    }

    /// Hard-deletes every item with `Status::Binned`. Walks back-to-front
    /// so deletions don't shift indices we haven't visited yet.
    pub fn empty_bin(&self) -> Result<usize, DocError> {
        let items = self.items();
        let mut removed = 0;
        for idx in (0..items.len()).rev() {
            let Some(map) = item_map_at(&items, idx) else { continue };
            if read_status(&map) == Some(Status::Binned) {
                items.delete(idx, 1)?;
                removed += 1;
            }
        }
        if removed > 0 {
            self.inner.commit();
        }
        Ok(removed)
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
        Ok(())
    }

    /// Refuses for the always-on `current` list. Items in the deleted
    /// list are reassigned to `current` so nothing falls off the doc.
    pub fn delete_list(&self, list_id: &str) -> Result<(), DocError> {
        if list_id == LIST_CURRENT {
            return Err(DocError::CannotDeleteBuiltin(LIST_CURRENT.into()));
        }
        let (idx, _) = self.find_list(list_id)?;
        let items = self.items();
        for i in 0..items.len() {
            let Some(map) = item_map_at(&items, i) else { continue };
            if read_string(&map, KEY_LIST_ID).as_deref() == Some(list_id) {
                map.insert(KEY_LIST_ID, LIST_CURRENT)?;
            }
        }
        self.lists().delete(idx, 1)?;
        self.inner.commit();
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

    /// Mark the local view as "everything in oplog has now been
    /// shipped." Call after the server's `OpsAck` lands so a follow-up
    /// `pending_export` doesn't re-send the same updates.
    pub fn mark_pushed(&mut self) {
        self.last_pushed_vv = self.inner.oplog_vv();
    }

    /// Decrypt and apply a peer op blob. After applying, also advances
    /// `last_pushed_vv` so we don't echo peer updates back through the
    /// next `pending_export` (the server already has them).
    pub fn apply_remote(&mut self, dek: &Dek, blob: &EncryptedBlob) -> Result<(), DocError> {
        if blob.nonce.len() != AEAD_NONCE_LEN {
            return Err(DocError::Invalid(format!(
                "expected {AEAD_NONCE_LEN}-byte nonce, got {}",
                blob.nonce.len()
            )));
        }
        let plaintext = dek.open(&blob.ciphertext, &blob.nonce)?;
        self.inner.import(&plaintext)?;
        self.last_pushed_vv = self.inner.oplog_vv();
        Ok(())
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
        Ok(Self { inner, last_pushed_vv })
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
    let now = now_millis();
    for (id, name) in [(LIST_CURRENT, "Current"), (LIST_HOLDING, "Holding")] {
        let map = lists.push_container(LoroMap::new())?;
        map.insert(KEY_ID, id)?;
        map.insert(KEY_NAME, name)?;
        map.insert(KEY_CREATED_AT, now)?;
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
) -> usize {
    let mut seen = 0usize;
    for i in 0..items.len() {
        if i == current_idx {
            continue;
        }
        let Some(map) = item_map_at(items, i) else { continue };
        if read_string(&map, KEY_LIST_ID).as_deref() == Some(target_list_id) {
            if seen == target_index {
                return i;
            }
            seen += 1;
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::Dek;

    #[test]
    fn new_doc_has_builtin_lists() {
        let doc = Doc::new().unwrap();
        let lists = doc.all_lists();
        let ids: Vec<_> = lists.iter().map(|l| l.id.as_str()).collect();
        assert!(ids.contains(&LIST_CURRENT));
        assert!(ids.contains(&LIST_HOLDING));
    }

    #[test]
    fn add_item_round_trips_through_get() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_CURRENT, "buy milk").unwrap();
        let view = doc.get_item(&id).unwrap();
        assert_eq!(view.text, "buy milk");
        assert_eq!(view.list_id, LIST_CURRENT);
        assert_eq!(view.status, Status::Live);
    }

    #[test]
    fn empty_text_rejected() {
        let doc = Doc::new().unwrap();
        let err = doc.add_item(LIST_CURRENT, "   ").unwrap_err();
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
        let id = doc.add_item(LIST_CURRENT, "thing").unwrap();
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
        let a = doc.add_item(LIST_CURRENT, "keep").unwrap();
        let b = doc.add_item(LIST_CURRENT, "drop").unwrap();
        doc.set_item_status(&b, Status::Binned).unwrap();
        let removed = doc.empty_bin().unwrap();
        assert_eq!(removed, 1);
        assert!(doc.get_item(&a).is_some());
        assert!(doc.get_item(&b).is_none());
    }

    #[test]
    fn delete_binned_only_works_for_binned() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_CURRENT, "live").unwrap();
        assert!(matches!(
            doc.delete_binned(&id).unwrap_err(),
            DocError::NotBinned
        ));
        doc.set_item_status(&id, Status::Binned).unwrap();
        doc.delete_binned(&id).unwrap();
        assert!(doc.get_item(&id).is_none());
    }

    #[test]
    fn delete_list_reassigns_items_to_current() {
        let doc = Doc::new().unwrap();
        let mylist = doc.add_list("Errands").unwrap();
        let id = doc.add_item(&mylist, "milk").unwrap();
        doc.delete_list(&mylist).unwrap();
        let view = doc.get_item(&id).unwrap();
        assert_eq!(view.list_id, LIST_CURRENT);
    }

    #[test]
    fn delete_current_refused() {
        let doc = Doc::new().unwrap();
        assert!(matches!(
            doc.delete_list(LIST_CURRENT).unwrap_err(),
            DocError::CannotDeleteBuiltin(_)
        ));
    }

    #[test]
    fn save_load_round_trip_preserves_state() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_CURRENT, "persisted").unwrap();
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

        let item_a = a.add_item(LIST_CURRENT, "from A").unwrap();

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
        let item_b = b.add_item(LIST_HOLDING, "from B").unwrap();
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
        let _ = a.add_item(LIST_CURRENT, "A only").unwrap();
        let _ = b.add_item(LIST_CURRENT, "B only").unwrap();
        a.mark_pushed();
        b.mark_pushed();
        assert_ne!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn apply_remote_rejects_wrong_dek() {
        let dek1 = Dek::generate();
        let dek2 = Dek::generate();
        let a = Doc::new().unwrap();
        let _ = a.add_item(LIST_CURRENT, "x").unwrap();
        let blob = a.pending_export(&dek1).unwrap().unwrap();

        let mut b = Doc::empty();
        let err = b.apply_remote(&dek2, &blob).unwrap_err();
        assert!(matches!(err, DocError::Crypto(_)));
    }
}
