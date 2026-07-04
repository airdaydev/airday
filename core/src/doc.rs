//! Loro CRDT layer: typed mutations, persistence, op-stream framing,
//! and a deterministic logical-state fingerprint.
//!
//! Layout matches `spec/data-model.md` (schema v2):
//! - root container `items` (`LoroMap`) — keyed by the item's stable
//!   UUID; each value is a child `LoroMap` with `id`, `text`,
//!   `location`, `created_at`, optional `notes`, optional `done_at`,
//!   optional `binned_at`. `done` and `binned` are orthogonal: an item
//!   can be both. Presence of the timestamp is the flag — there's no
//!   separate boolean.
//! - root container `lists` (`LoroMovableList`) — each entry is a
//!   `LoroMap` with `id`, `name`, `created_at`.
//! - root container `settings` (`LoroMap`) — account-wide synced
//!   workspace settings not owned by a specific list row.
//! - one root container `order/<list-id>` (`LoroMovableList`) per
//!   logical list — **scalar entries only**, each an encoded
//!   `"<item_id>:<placement_id>"` string. Ordering lives here;
//!   everything else lives on the item map. There is no document-wide
//!   item list: reordering one list touches only that list's container.
//!
//! An item's `location` is a single atomic register encoding
//! `"<list_id>:<placement_id>"`. It is authoritative for membership;
//! an order entry is *visible* only when its placement matches the
//! item's current location (see `spec/data-model.md` "Projection
//! invariants"). Stale/duplicate entries left behind by concurrent
//! cross-list moves are harmless and cleaned by [`Doc::reconcile`].
//!
//! Binned is a status & items keep their location. One well-known
//! list id is *reserved*: [`LIST_MAIN`]. It has **no ListMeta row** —
//! items reference it by string id and clients render it with a
//! hardcoded label ("Queue").
//!
//! The struct holds a `last_pushed_vv` so we can hand the sync engine
//! "what's new since the last server interaction" as a single sealed
//! blob without re-shipping ops we already saw.

#[cfg(not(target_arch = "wasm32"))]
use std::time::{SystemTime, UNIX_EPOCH};

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use loro::event::{Diff as LoroDiff, DiffEvent, ListDiffItem};
use loro::{
    Container, ContainerID, EventTriggerKind, ExportMode, LoroDoc, LoroMap, LoroMovableList,
    LoroValue, Subscription, UndoManager, ValueOrContainer, VersionVector,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::crypto::{AEAD_NONCE_LEN, Dek};
use crate::events::AppEvent;
use airday_protocol::EncryptedBlob;

pub const LIST_MAIN: &str = "main";
pub const LIST_MAIN_NAME: &str = "Queue";

const ROOT_ITEMS: &str = "items";
const ROOT_LISTS: &str = "lists";
const ROOT_SETTINGS: &str = "settings";
/// Root-container name prefix for per-list order containers:
/// `order/main`, `order/<list-uuid>`. The container for a deleted list
/// is simply never projected again (root containers can't be removed).
const ORDER_PREFIX: &str = "order/";

const KEY_ID: &str = "id";
const KEY_TEXT: &str = "text";
const KEY_NOTES: &str = "notes";
/// Atomic location register: `"<list_id>:<placement_id>"`. Written as
/// one scalar so list membership and placement can never be torn apart
/// by concurrent edits. See `Location`.
const KEY_LOCATION: &str = "location";
const KEY_NAME: &str = "name";
const KEY_CREATED_AT: &str = "created_at";
const KEY_DONE_AT: &str = "done_at";
const KEY_BINNED_AT: &str = "binned_at";
/// Global "show counts on non-Queue lists" flag. Lives on the doc-level
/// settings map; Queue's own count is always visible (when non-zero) and
/// is not gated by this. Absent ≡ false — written only when toggled on
/// (and removed when toggled back off) so docs that have never enabled
/// it carry no key.
const KEY_SHOW_LIST_COUNTS: &str = "show_list_counts";
/// Optional user-chosen display name override for the reserved `main`
/// (Queue) list. Absent ≡ no override; clients render the localized
/// built-in label (`LIST_MAIN_NAME` / `i18n nav.home`) in that case.
const KEY_MAIN_NAME: &str = "main_name";
/// Batch status mutations at/above this many ids stop emitting
/// surgical per-item events and fall back to one whole-doc rebuild +
/// diff. Matches the web store's coarse-projection threshold so both
/// layers flip regimes together.
const BULK_STATUS_EVENT_THRESHOLD: usize = 64;
/// Captured operations touching at least this many items abandon per-item
/// diff translation for the whole-doc resync fallback — one O(doc) pass
/// beats per-item projection syncs for bulk imports or undo steps.
const DIFF_TRANSLATE_MAX_DIRTY: usize = 64;

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
/// `list_id` is derived from the atomic `location` register.
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettingsView {
    /// When true, clients render each non-Queue list's live-item count
    /// in the nav (subject to the count > 0 gate). Queue's count is
    /// always shown regardless. Single global flag; default false.
    pub show_list_counts: bool,
    /// User-chosen override for the reserved `main` (Queue) list's
    /// display name. `None` (or absent in storage) means clients render
    /// the localized built-in label.
    pub main_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JsonExport {
    pub version: u32,
    pub settings: ExportSettings,
    pub lists: Vec<ExportList>,
    pub items: Vec<ExportItem>,
}

/// Counts surfaced to the UI after a successful `import_json`.
/// `items_skipped` covers entries dropped because their `text` was
/// empty after trim — defensively guarded so a malformed export can't
/// land empty rows in the doc.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub lists_added: usize,
    pub items_added: usize,
    pub items_skipped: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSettings {
    pub show_list_counts: bool,
    /// `None` when the user hasn't overridden Queue's display name.
    /// Skipped when serializing to keep the JSON dump minimal for the
    /// default case.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub main_name: Option<String>,
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

// ---------- location / order-entry encoding ----------

/// Atomic item placement: which list an item is in, and which order
/// entry is the canonical one for it. Encoded as a single scalar string
/// (`"<list_id>:<placement_id>"`) so both halves are written in one
/// register op — no independently-mergeable sub-fields to conflict.
/// `:` is reserved: ids are uuid-v7 hex or the literal `main`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Location {
    list_id: String,
    placement_id: String,
}

impl Location {
    fn encode(&self) -> String {
        format!("{}:{}", self.list_id, self.placement_id)
    }
    fn parse(s: &str) -> Option<Location> {
        let (list_id, placement_id) = s.split_once(':')?;
        if list_id.is_empty() {
            return None;
        }
        Some(Location {
            list_id: list_id.to_string(),
            placement_id: placement_id.to_string(),
        })
    }
}

/// One element of an `order/<list-id>` container:
/// `"<item_id>:<placement_id>"`.
#[derive(Debug, Clone, PartialEq, Eq)]
struct OrderEntry {
    item_id: String,
    placement_id: String,
}

impl OrderEntry {
    fn encode(&self) -> String {
        format!("{}:{}", self.item_id, self.placement_id)
    }
    fn parse(s: &str) -> Option<OrderEntry> {
        let (item_id, placement_id) = s.split_once(':')?;
        if item_id.is_empty() {
            return None;
        }
        Some(OrderEntry {
            item_id: item_id.to_string(),
            placement_id: placement_id.to_string(),
        })
    }
}

fn order_root_name(list_id: &str) -> String {
    format!("{ORDER_PREFIX}{list_id}")
}

// ---------- disposable projection index ----------

/// Per-item slice of the state the projection needs, mirrored in
/// memory so per-mutation work never touches Loro containers beyond
/// the mutation itself.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ItemMeta {
    list_id: String,
    placement_id: String,
    live: bool,
    created_at: i64,
}

/// Resolution of a target index against a list's projection — the raw
/// container position to write at, and (when exact) the live splice
/// position. See [`ProjectionIndex::plan_target`].
struct TargetPlan {
    raw_pos: usize,
    live_pos: Option<usize>,
}

/// Disposable in-memory mirror of everything ordering-related.
/// Maintained incrementally by local mutations, surgically by remote
/// diff translation, and rebuilt wholesale from the doc on boot or
/// fallback. Never persisted.
#[derive(Default)]
struct ProjectionIndex {
    /// item id → location/status slice.
    meta: HashMap<String, ItemMeta>,
    /// list id → item ids located there (authoritative membership).
    members: HashMap<String, HashSet<String>>,
    /// list id → positional mirror of `order/<list-id>`. `None` slots
    /// keep unparseable entries position-aligned with the container.
    raw_orders: HashMap<String, Vec<Option<OrderEntry>>>,
    /// list id → live projection (visible entries filtered to live
    /// items, then the deterministic fallback tail). Lists with no live
    /// items carry no key.
    live_by_list: HashMap<String, Vec<String>>,
    /// list id → number of *visible* entries in that list's order
    /// container (any status). `members(list).len() == visible` ⟺ the
    /// list has no fallback tail — the precondition for the O(live)
    /// splice fast paths; anything tail-adjacent falls back to a full
    /// `refresh_live` walk. Lists with zero visible entries carry no
    /// key.
    visible_counts: HashMap<String, usize>,
}

impl ProjectionIndex {
    /// Visible entry ids of `list_id` in container order (all statuses,
    /// duplicate-guarded), borrowed — plus the visible set for the tail
    /// computation. An entry is visible iff its item exists, its
    /// placement matches the item's authoritative location, and no
    /// earlier entry already claimed the item.
    fn visible_ids<'a>(&'a self, list_id: &str) -> (Vec<&'a str>, HashSet<&'a str>) {
        let mut out = Vec::new();
        let mut seen = HashSet::new();
        for entry in self
            .raw_orders
            .get(list_id)
            .map(Vec::as_slice)
            .unwrap_or(&[])
            .iter()
            .flatten()
        {
            let Some(m) = self.meta.get(&entry.item_id) else {
                continue;
            };
            if m.list_id == list_id
                && m.placement_id == entry.placement_id
                && seen.insert(entry.item_id.as_str())
            {
                out.push(entry.item_id.as_str());
            }
        }
        (out, seen)
    }

    /// Fallback tail: items located in `list_id` with no visible entry,
    /// sorted by `(created_at, id)` so replicas agree.
    fn tail<'a>(&'a self, list_id: &str, seen: &HashSet<&str>) -> Vec<&'a str> {
        let mut tail: Vec<&'a str> = self
            .members
            .get(list_id)
            .into_iter()
            .flatten()
            .filter(|id| !seen.contains(id.as_str()))
            .map(String::as_str)
            .collect();
        tail.sort_by(|a, b| {
            let (ma, mb) = (&self.meta[*a], &self.meta[*b]);
            ma.created_at.cmp(&mb.created_at).then_with(|| a.cmp(b))
        });
        tail
    }

    /// Resolve one list: (resolved order over all statuses, live
    /// subset). Pure — reads only the in-memory mirrors.
    fn project(&self, list_id: &str) -> (Vec<String>, Vec<String>) {
        let (mut ids, seen) = self.visible_ids(list_id);
        ids.extend(self.tail(list_id, &seen));
        let resolved: Vec<String> = ids.iter().map(|s| (*s).to_string()).collect();
        let live = ids
            .iter()
            .filter(|id| self.meta.get(**id).is_some_and(|m| m.live))
            .map(|s| (*s).to_string())
            .collect();
        (resolved, live)
    }

    /// Recompute and store `list_id`'s live projection (and visible
    /// count); returns the projection. One walk covers both; only the
    /// live ids are cloned, so a 13k-lifetime list with 200 live items
    /// allocates 200 strings, not 2×13k.
    fn refresh_live(&mut self, list_id: &str) -> Vec<String> {
        let (live, visible) = {
            let (ids, seen) = self.visible_ids(list_id);
            let visible = ids.len();
            let is_live = |id: &str| self.meta.get(id).is_some_and(|m| m.live);
            let mut live: Vec<String> = ids
                .into_iter()
                .filter(|id| is_live(id))
                .map(str::to_string)
                .collect();
            live.extend(
                self.tail(list_id, &seen)
                    .into_iter()
                    .filter(|id| is_live(id))
                    .map(str::to_string),
            );
            (live, visible)
        };
        if visible == 0 {
            self.visible_counts.remove(list_id);
        } else {
            self.visible_counts.insert(list_id.to_string(), visible);
        }
        if live.is_empty() {
            self.live_by_list.remove(list_id);
        } else {
            self.live_by_list.insert(list_id.to_string(), live.clone());
        }
        live
    }

    /// True when every item located in `list_id` is entry-backed — no
    /// fallback tail exists, so append positions are exact without a
    /// walk.
    fn tail_is_empty(&self, list_id: &str) -> bool {
        let members = self.members.get(list_id).map(HashSet::len).unwrap_or(0);
        let visible = self.visible_counts.get(list_id).copied().unwrap_or(0);
        members == visible
    }

    fn bump_visible(&mut self, list_id: &str, delta: isize) {
        let cur = self.visible_counts.get(list_id).copied().unwrap_or(0) as isize;
        let next = (cur + delta).max(0) as usize;
        if next == 0 {
            self.visible_counts.remove(list_id);
        } else {
            self.visible_counts.insert(list_id.to_string(), next);
        }
    }

    /// Splice `id` into `list_id`'s live projection at `at`.
    fn splice_live_in(&mut self, list_id: &str, id: &str, at: usize) {
        let arr = self.live_by_list.entry(list_id.to_string()).or_default();
        arr.retain(|x| x != id);
        let at = at.min(arr.len());
        arr.insert(at, id.to_string());
    }

    /// Remove `id` from `list_id`'s live projection.
    fn splice_live_out(&mut self, list_id: &str, id: &str) {
        if let Some(arr) = self.live_by_list.get_mut(list_id) {
            arr.retain(|x| x != id);
            if arr.is_empty() {
                self.live_by_list.remove(list_id);
            }
        }
    }

    /// Resolve a caller's target index against `list_id`'s projection
    /// (live projection for live items, full resolved order for hidden
    /// ones), excluding `exclude` from the anchor count when the item
    /// is being re-placed within its own list.
    ///
    /// `live_pos` is the exact live splice position when it can be
    /// derived without a projection walk: `Some(target)` when the
    /// anchor's canonical entry resolved, `Some(usize::MAX)` (append —
    /// the splice clamps) when inserting past the end of a list with no
    /// fallback tail, and `None` when the caller must `refresh_live`
    /// after mutating (tail-adjacent cases). Hidden-item plans always
    /// carry `live_pos: Some(usize::MAX)` — the live array is untouched
    /// by hidden mutations, so no refresh is needed on their account.
    fn plan_target(
        &self,
        list_id: &str,
        target_index: usize,
        is_live: bool,
        exclude: Option<&str>,
    ) -> TargetPlan {
        let raw_len = self.raw_orders.get(list_id).map(Vec::len).unwrap_or(0);
        if !is_live {
            let seq = self.project(list_id).0;
            let anchor_index = match exclude.and_then(|e| seq.iter().position(|x| x == e)) {
                Some(c) if c <= target_index => target_index.saturating_add(1),
                _ => target_index,
            };
            let raw_pos = seq
                .get(anchor_index)
                .and_then(|a| self.canonical_raw_pos(list_id, a))
                .unwrap_or(raw_len);
            return TargetPlan {
                raw_pos,
                live_pos: Some(usize::MAX),
            };
        }
        static EMPTY: Vec<String> = Vec::new();
        let seq = self.live_by_list.get(list_id).unwrap_or(&EMPTY);
        let anchor_index = match exclude.and_then(|e| seq.iter().position(|x| x == e)) {
            Some(c) if c <= target_index => target_index.saturating_add(1),
            _ => target_index,
        };
        match seq.get(anchor_index) {
            Some(anchor) => match self.canonical_raw_pos(list_id, anchor) {
                // Inserting immediately before the anchor puts the item
                // at exactly `target_index` (the exclude-skip above is
                // what makes that hold for same-list re-placement too).
                Some(ap) => TargetPlan {
                    raw_pos: ap,
                    live_pos: Some(target_index),
                },
                // Anchor lives in the fallback tail — position within
                // the live projection needs a walk.
                None => TargetPlan {
                    raw_pos: raw_len,
                    live_pos: None,
                },
            },
            None => TargetPlan {
                raw_pos: raw_len,
                live_pos: if self.tail_is_empty(list_id) {
                    Some(usize::MAX)
                } else {
                    None
                },
            },
        }
    }

    /// Raw container position of the item's canonical (visible) entry.
    fn canonical_raw_pos(&self, list_id: &str, item_id: &str) -> Option<usize> {
        let m = self.meta.get(item_id)?;
        if m.list_id != list_id {
            return None;
        }
        self.raw_orders.get(list_id)?.iter().position(|e| {
            e.as_ref()
                .is_some_and(|e| e.item_id == item_id && e.placement_id == m.placement_id)
        })
    }

    /// Every raw position holding an entry for `item_id` in `list_id`
    /// (canonical, stale, and duplicates alike), ascending.
    fn entry_positions(&self, list_id: &str, item_id: &str) -> Vec<usize> {
        self.raw_orders
            .get(list_id)
            .map(Vec::as_slice)
            .unwrap_or(&[])
            .iter()
            .enumerate()
            .filter_map(|(i, e)| {
                e.as_ref()
                    .is_some_and(|e| e.item_id == item_id)
                    .then_some(i)
            })
            .collect()
    }

    fn set_meta(&mut self, id: &str, meta: ItemMeta) {
        if let Some(old) = self.meta.get(id)
            && old.list_id != meta.list_id
            && let Some(s) = self.members.get_mut(&old.list_id)
        {
            s.remove(id);
            if s.is_empty() {
                self.members.remove(&old.list_id);
            }
        }
        self.members
            .entry(meta.list_id.clone())
            .or_default()
            .insert(id.to_string());
        self.meta.insert(id.to_string(), meta);
    }

    fn remove_item(&mut self, id: &str) {
        if let Some(old) = self.meta.remove(id)
            && let Some(s) = self.members.get_mut(&old.list_id)
        {
            s.remove(id);
            if s.is_empty() {
                self.members.remove(&old.list_id);
            }
        }
    }
}

// ---------- gated diff capture (remote import / undo translation) ----------

/// Owned copy of one Loro container diff captured while an import or
/// undo/redo operation is in progress. Ordinary local mutations emit
/// `AppEvent`s directly and are never captured.
enum CapturedDiff {
    /// Root `items` map changed: item containers appeared / vanished.
    ItemsRoot {
        upserted: Vec<String>,
        removed: Vec<String>,
    },
    /// One item's map changed; which keys were touched.
    ItemMap {
        container: ContainerID,
        keys: Vec<String>,
    },
    /// One `order/<list-id>` container changed (insert/delete/move).
    Order {
        list_id: String,
        ops: Vec<CapturedListItem>,
    },
    /// Root `lists` MovableList or one of its list maps changed. Lists
    /// are few, so translation just re-diffs them wholesale.
    Lists,
    /// Doc-level settings map changed.
    Settings,
    /// A diff shape we don't translate — forces the full-resync
    /// fallback for the frame.
    Opaque,
}

enum CapturedListItem {
    Retain(usize),
    Delete(usize),
    /// Inserted (or move-target) scalar entries. `None` for a
    /// non-string value, which we never produce — it lands as an
    /// unparseable (invisible) slot rather than aborting the frame.
    Insert(Vec<Option<String>>),
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum DiffCaptureMode {
    #[default]
    None,
    Import,
    Undo,
}

#[derive(Default)]
struct DiffCapture {
    mode: DiffCaptureMode,
    diffs: Vec<CapturedDiff>,
}

fn classify_captured_diff(
    target: &ContainerID,
    path_root: Option<&ContainerID>,
    diff: &LoroDiff,
) -> CapturedDiff {
    let root_name = |cid: &ContainerID| match cid {
        ContainerID::Root { name, .. } => Some(name.to_string()),
        ContainerID::Normal { .. } => None,
    };
    match root_name(target) {
        Some(name) if name == ROOT_ITEMS => {
            let LoroDiff::Map(m) = diff else {
                return CapturedDiff::Opaque;
            };
            let mut upserted = Vec::new();
            let mut removed = Vec::new();
            for (k, v) in m.updated.iter() {
                match v {
                    Some(_) => upserted.push(k.to_string()),
                    None => removed.push(k.to_string()),
                }
            }
            CapturedDiff::ItemsRoot { upserted, removed }
        }
        Some(name) if name == ROOT_LISTS => CapturedDiff::Lists,
        Some(name) if name == ROOT_SETTINGS => CapturedDiff::Settings,
        Some(name) => {
            let Some(list_id) = name.strip_prefix(ORDER_PREFIX) else {
                return CapturedDiff::Opaque;
            };
            let LoroDiff::List(items) = diff else {
                return CapturedDiff::Opaque;
            };
            CapturedDiff::Order {
                list_id: list_id.to_string(),
                ops: items
                    .iter()
                    .map(|it| match it {
                        ListDiffItem::Retain { retain } => CapturedListItem::Retain(*retain),
                        ListDiffItem::Delete { delete } => CapturedListItem::Delete(*delete),
                        ListDiffItem::Insert { insert, .. } => CapturedListItem::Insert(
                            insert
                                .iter()
                                .map(|v| match v {
                                    ValueOrContainer::Value(LoroValue::String(s)) => {
                                        Some(s.to_string())
                                    }
                                    _ => None,
                                })
                                .collect(),
                        ),
                    })
                    .collect(),
            }
        }
        None => {
            // Nested container: an item map or a list map. Route by the
            // root container at the head of its path.
            let Some(root) = path_root.and_then(root_name) else {
                return CapturedDiff::Opaque;
            };
            if root == ROOT_LISTS {
                return CapturedDiff::Lists;
            }
            if root != ROOT_ITEMS {
                return CapturedDiff::Opaque;
            }
            let LoroDiff::Map(m) = diff else {
                return CapturedDiff::Opaque;
            };
            CapturedDiff::ItemMap {
                container: target.clone(),
                keys: m.updated.keys().map(|k| k.to_string()).collect(),
            }
        }
    }
}

fn make_diff_subscriber(
    capture: Arc<Mutex<DiffCapture>>,
) -> Arc<dyn for<'a> Fn(DiffEvent<'a>) + Send + Sync> {
    Arc::new(move |e: DiffEvent<'_>| {
        // NOTE: Loro invokes subscribers re-entrantly from inside
        // import/commit — do not touch the doc here, only stash owned
        // data.
        let Ok(mut capture) = capture.lock() else {
            return;
        };
        let should_capture = matches!(
            (capture.mode, e.triggered_by),
            (DiffCaptureMode::Import, EventTriggerKind::Import)
                | (DiffCaptureMode::Undo, EventTriggerKind::Local)
        );
        if !should_capture {
            return;
        }
        for cd in &e.events {
            let path_root = cd.path.first().map(|(cid, _)| cid);
            capture
                .diffs
                .push(classify_captured_diff(cd.target, path_root, &cd.diff));
        }
    })
}

pub struct Doc {
    inner: LoroDoc,
    last_pushed_vv: VersionVector,
    /// Domain-level change events. Mutation methods push directly;
    /// `apply_remote` does diff translation and pushes a batch. Drain
    /// via `pop_event` / `drain_events`. Wrapped in `Mutex` so mutation
    /// methods can stay `&self` (Loro's interior-mutability shape).
    events: Mutex<VecDeque<AppEvent>>,
    /// Per-session undo/redo. Bound to the local peer at construction;
    /// only records local commits. Remote ops imported by
    /// `apply_remote` carry origin `"remote"` and are filtered out by
    /// prefix — see `spec/sync-protocol.md` "Commit origin tagging".
    undo: Mutex<UndoManager>,
    /// Disposable projection index — see [`ProjectionIndex`]. Rebuilt
    /// from `inner` after boot replay / fallback and maintained
    /// incrementally otherwise.
    item_index: Mutex<ProjectionIndex>,
    /// Gated Loro diff capture used by remote import and undo/redo. The
    /// gate prevents ordinary local mutations from accumulating diffs;
    /// callers enable it only around the operation they will translate.
    diff_capture: Arc<Mutex<DiffCapture>>,
    /// Root diff subscription feeding `diff_capture`. Dropping it
    /// unsubscribes, so it lives exactly as long as the doc.
    _diff_sub: Subscription,
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
        let item_index = Mutex::new(ProjectionIndex::default());
        let diff_capture = Arc::new(Mutex::new(DiffCapture::default()));
        let _diff_sub = inner.subscribe_root(make_diff_subscriber(diff_capture.clone()));
        Ok(Self {
            inner,
            last_pushed_vv: VersionVector::default(),
            events: Mutex::new(VecDeque::new()),
            undo,
            item_index,
            diff_capture,
            _diff_sub,
        })
    }

    /// Empty doc — used by device 2 before snapshot import.
    pub fn empty() -> Self {
        let inner = LoroDoc::new();
        let undo = Mutex::new(make_undo_manager(&inner));
        let item_index = Mutex::new(ProjectionIndex::default());
        let diff_capture = Arc::new(Mutex::new(DiffCapture::default()));
        let _diff_sub = inner.subscribe_root(make_diff_subscriber(diff_capture.clone()));
        Self {
            last_pushed_vv: inner.oplog_vv(),
            inner,
            events: Mutex::new(VecDeque::new()),
            undo,
            item_index,
            diff_capture,
            _diff_sub,
        }
    }

    fn begin_diff_capture(&self, mode: DiffCaptureMode) {
        let mut capture = self.diff_capture.lock().expect("diff capture poisoned");
        capture.diffs.clear();
        capture.mode = mode;
    }

    fn finish_diff_capture(&self) -> Vec<CapturedDiff> {
        let mut capture = self.diff_capture.lock().expect("diff capture poisoned");
        capture.mode = DiffCaptureMode::None;
        std::mem::take(&mut capture.diffs)
    }

    /// Recompute the whole [`ProjectionIndex`] from the doc. O(items +
    /// order entries); used on boot, after bulk operations, and by the
    /// translation fallback.
    fn rebuild_index(&self) {
        *self.item_index.lock().expect("item index mutex poisoned") = self.compute_index();
    }

    /// Build a fresh [`ProjectionIndex`] straight from the Loro
    /// containers, without installing it. Shared by `rebuild_index` and
    /// the test-side "does the incremental index match the doc" check.
    fn compute_index(&self) -> ProjectionIndex {
        let items = self.items();
        let mut idx = ProjectionIndex::default();
        let keys: Vec<String> = items.keys().map(|k| k.to_string()).collect();
        for id in keys {
            let Some(map) = item_map_of(&items, &id) else {
                continue;
            };
            let meta = item_meta(&map);
            idx.members
                .entry(meta.list_id.clone())
                .or_default()
                .insert(id.clone());
            idx.meta.insert(id, meta);
        }
        let mut candidates: HashSet<String> = idx.members.keys().cloned().collect();
        candidates.insert(LIST_MAIN.to_string());
        for list in self.all_lists() {
            candidates.insert(list.id);
        }
        for list_id in &candidates {
            let order = self.order_list(list_id);
            let mut raw = Vec::with_capacity(order.len());
            for i in 0..order.len() {
                raw.push(scalar_entry_at(&order, i));
            }
            idx.raw_orders.insert(list_id.clone(), raw);
        }
        for list_id in &candidates {
            idx.refresh_live(list_id);
        }
        idx
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
        self.add_item_at(list_id, text, usize::MAX)
    }

    /// Insert a new item as the `target_index`-th live entry of
    /// `list_id`, in a single Loro commit. `target_index` past the end
    /// of the visible live items appends.
    pub fn add_item_at(
        &self,
        list_id: &str,
        text: &str,
        target_index: usize,
    ) -> Result<String, DocError> {
        let ids = self.add_items_at(list_id, &[text], target_index)?;
        Ok(ids.into_iter().next().expect("one text yields one id"))
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
        let plan = self.plan_target(list_id, target_index, true, None);
        let raw_pos = plan.raw_pos;
        let items = self.items();
        let order = self.order_list(list_id);
        let mut ids = Vec::with_capacity(trimmed.len());
        let mut pending: Vec<(String, String, String, i64)> = Vec::with_capacity(trimmed.len());
        for (i, text) in trimmed.iter().enumerate() {
            let id = new_id();
            let placement = new_id();
            let now = now_millis();
            let map = items.insert_container(&id, LoroMap::new())?;
            map.insert(KEY_ID, id.as_str())?;
            map.insert(KEY_TEXT, *text)?;
            map.insert(KEY_CREATED_AT, now)?;
            map.insert(
                KEY_LOCATION,
                Location {
                    list_id: list_id.to_string(),
                    placement_id: placement.clone(),
                }
                .encode()
                .as_str(),
            )?;
            let entry = OrderEntry {
                item_id: id.clone(),
                placement_id: placement.clone(),
            }
            .encode();
            let at = raw_pos + i;
            if at >= order.len() {
                order.push(entry.as_str())?;
            } else {
                order.insert(at, entry.as_str())?;
            }
            pending.push((id.clone(), placement, (*text).to_string(), now));
            ids.push(id);
        }
        self.inner.commit();
        let live = {
            let mut guard = self.item_index.lock().expect("item index mutex poisoned");
            for (i, (id, placement, _, now)) in pending.iter().enumerate() {
                guard.set_meta(
                    id,
                    ItemMeta {
                        list_id: list_id.to_string(),
                        placement_id: placement.clone(),
                        live: true,
                        created_at: *now,
                    },
                );
                let raw = guard.raw_orders.entry(list_id.to_string()).or_default();
                let at = (raw_pos + i).min(raw.len());
                raw.insert(
                    at,
                    Some(OrderEntry {
                        item_id: id.clone(),
                        placement_id: placement.clone(),
                    }),
                );
                guard.bump_visible(list_id, 1);
            }
            match plan.live_pos {
                Some(pos) => {
                    for (i, (id, ..)) in pending.iter().enumerate() {
                        guard.splice_live_in(list_id, id, pos.saturating_add(i));
                    }
                    guard.live_by_list.get(list_id).cloned().unwrap_or_default()
                }
                None => guard.refresh_live(list_id),
            }
        };
        for (id, _, text, now) in pending {
            let live_index = live.iter().position(|x| x == &id);
            self.push_event(AppEvent::ItemAdded {
                id,
                list_id: list_id.to_string(),
                text,
                notes: String::new(),
                created_at: now,
                done_at: None,
                binned_at: None,
                live_index,
            });
        }
        Ok(ids)
    }

    pub fn edit_item_text(&self, item_id: &str, text: &str) -> Result<(), DocError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(DocError::Invalid("item text is empty".into()));
        }
        let map = self.find_item(item_id)?;
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
        let map = self.find_item(item_id)?;
        map.insert(KEY_NOTES, notes)?;
        self.inner.commit();
        self.push_event(AppEvent::ItemNotesChanged {
            id: item_id.to_string(),
            notes: notes.to_string(),
        });
        Ok(())
    }

    /// Move an item. Same-list: a `mov` on the list's order container
    /// (placement preserved). Cross-list: fresh placement, one atomic
    /// `location` write, entry insert in the target order, best-effort
    /// entry removal from the source order — all in one commit (one
    /// undo step). `target_index` addresses the live projection for
    /// live items and the full resolved order for done/binned items.
    pub fn move_item(
        &self,
        item_id: &str,
        target_list_id: &str,
        target_index: usize,
    ) -> Result<(), DocError> {
        self.assert_list_exists(target_list_id)?;
        let map = self.find_item(item_id)?;
        let (cur_list, is_live) = {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            let m = guard
                .meta
                .get(item_id)
                .ok_or_else(|| DocError::ItemNotFound(item_id.to_string()))?;
            (m.list_id.clone(), m.live)
        };
        if cur_list == target_list_id {
            self.reorder_in_list(item_id, &map, target_list_id, target_index, is_live)
        } else {
            self.move_across_lists(
                item_id,
                &map,
                &cur_list,
                target_list_id,
                target_index,
                is_live,
            )
        }
    }

    fn reorder_in_list(
        &self,
        item_id: &str,
        map: &LoroMap,
        list_id: &str,
        target_index: usize,
        is_live: bool,
    ) -> Result<(), DocError> {
        let (from, to, live_plan) = {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            let Some(from) = guard.canonical_raw_pos(list_id, item_id) else {
                // Fallback-tail item (no visible entry): re-place it
                // with a fresh entry instead of a mov.
                drop(guard);
                return self.replace_entry(item_id, map, list_id, target_index, is_live);
            };
            // Anchor over the projection the caller's index speaks
            // about (live for live items, full resolved order for
            // hidden ones), excluding the moving item.
            let plan = guard.plan_target(list_id, target_index, is_live, Some(item_id));
            // `raw_pos` is an insert-before position; a `mov` of an
            // earlier element shifts everything after it left by one.
            let to = if plan.raw_pos > from {
                plan.raw_pos.saturating_sub(1)
            } else {
                plan.raw_pos
            };
            (from, to, plan.live_pos)
        };
        if from == to {
            return Ok(());
        }
        self.order_list(list_id).mov(from, to)?;
        self.inner.commit();
        let live_index = {
            let mut guard = self.item_index.lock().expect("item index mutex poisoned");
            if let Some(raw) = guard.raw_orders.get_mut(list_id) {
                let e = raw.remove(from);
                raw.insert(to.min(raw.len()), e);
            }
            if !is_live {
                None
            } else {
                match live_plan {
                    Some(pos) => {
                        guard.splice_live_in(list_id, item_id, pos);
                        guard
                            .live_by_list
                            .get(list_id)
                            .and_then(|arr| arr.iter().position(|x| x == item_id))
                    }
                    None => {
                        let live = guard.refresh_live(list_id);
                        live.iter().position(|x| x == item_id)
                    }
                }
            }
        };
        self.push_event(AppEvent::ItemMoved {
            id: item_id.to_string(),
            live_index,
        });
        Ok(())
    }

    /// Re-place an item inside its own list with a fresh placement +
    /// entry. Used when a same-list move targets a fallback-tail item
    /// (its canonical entry was lost); functionally a cross-list move
    /// whose source and target coincide.
    fn replace_entry(
        &self,
        item_id: &str,
        map: &LoroMap,
        list_id: &str,
        target_index: usize,
        is_live: bool,
    ) -> Result<(), DocError> {
        let placement = new_id();
        map.insert(
            KEY_LOCATION,
            Location {
                list_id: list_id.to_string(),
                placement_id: placement.clone(),
            }
            .encode()
            .as_str(),
        )?;
        let raw_pos = self
            .plan_target(list_id, target_index, is_live, Some(item_id))
            .raw_pos;
        let order = self.order_list(list_id);
        let entry = OrderEntry {
            item_id: item_id.to_string(),
            placement_id: placement.clone(),
        };
        if raw_pos >= order.len() {
            order.push(entry.encode().as_str())?;
        } else {
            order.insert(raw_pos, entry.encode().as_str())?;
        }
        self.inner.commit();
        let live_index = {
            let mut guard = self.item_index.lock().expect("item index mutex poisoned");
            if let Some(m) = guard.meta.get_mut(item_id) {
                m.placement_id = placement;
            }
            let raw = guard.raw_orders.entry(list_id.to_string()).or_default();
            let at = raw_pos.min(raw.len());
            raw.insert(at, Some(entry));
            // Rare path — a full refresh also recomputes the visible
            // count now that a tail item became entry-backed.
            let live = guard.refresh_live(list_id);
            if is_live {
                live.iter().position(|x| x == item_id)
            } else {
                None
            }
        };
        self.push_event(AppEvent::ItemMoved {
            id: item_id.to_string(),
            live_index,
        });
        Ok(())
    }

    fn move_across_lists(
        &self,
        item_id: &str,
        map: &LoroMap,
        cur_list: &str,
        target_list_id: &str,
        target_index: usize,
        is_live: bool,
    ) -> Result<(), DocError> {
        let placement = new_id();
        let created_at = read_i64(map, KEY_CREATED_AT).unwrap_or(0);
        map.insert(
            KEY_LOCATION,
            Location {
                list_id: target_list_id.to_string(),
                placement_id: placement.clone(),
            }
            .encode()
            .as_str(),
        )?;
        let (plan, src_positions, was_visible) = {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            (
                guard.plan_target(target_list_id, target_index, is_live, None),
                guard.entry_positions(cur_list, item_id),
                guard.canonical_raw_pos(cur_list, item_id).is_some(),
            )
        };
        let raw_pos = plan.raw_pos;
        let target_order = self.order_list(target_list_id);
        let entry = OrderEntry {
            item_id: item_id.to_string(),
            placement_id: placement.clone(),
        };
        if raw_pos >= target_order.len() {
            target_order.push(entry.encode().as_str())?;
        } else {
            target_order.insert(raw_pos, entry.encode().as_str())?;
        }
        // Best-effort cleanup: drop every entry for this item from the
        // source order (canonical + any stale duplicates).
        let src_order = self.order_list(cur_list);
        for p in src_positions.iter().rev() {
            src_order.delete(*p, 1)?;
        }
        self.inner.commit();
        let live_index = {
            let mut guard = self.item_index.lock().expect("item index mutex poisoned");
            guard.set_meta(
                item_id,
                ItemMeta {
                    list_id: target_list_id.to_string(),
                    placement_id: placement,
                    live: is_live,
                    created_at,
                },
            );
            if let Some(raw) = guard.raw_orders.get_mut(cur_list) {
                for p in src_positions.iter().rev() {
                    if *p < raw.len() {
                        raw.remove(*p);
                    }
                }
            }
            if was_visible {
                guard.bump_visible(cur_list, -1);
            }
            let raw = guard
                .raw_orders
                .entry(target_list_id.to_string())
                .or_default();
            let at = raw_pos.min(raw.len());
            raw.insert(at, Some(entry));
            guard.bump_visible(target_list_id, 1);
            if !is_live {
                None
            } else {
                guard.splice_live_out(cur_list, item_id);
                match plan.live_pos {
                    Some(pos) => {
                        guard.splice_live_in(target_list_id, item_id, pos);
                        guard
                            .live_by_list
                            .get(target_list_id)
                            .and_then(|arr| arr.iter().position(|x| x == item_id))
                    }
                    None => {
                        let live = guard.refresh_live(target_list_id);
                        live.iter().position(|x| x == item_id)
                    }
                }
            }
        };
        self.push_event(AppEvent::ItemListChanged {
            id: item_id.to_string(),
            list_id: target_list_id.to_string(),
            live_index,
        });
        Ok(())
    }

    /// Resolve a target index against `list_id`'s projection: the raw
    /// container position for the entry write, plus — when derivable
    /// without a walk — the exact live splice position. See
    /// [`ProjectionIndex::plan_target`].
    fn plan_target(
        &self,
        list_id: &str,
        target_index: usize,
        is_live: bool,
        exclude: Option<&str>,
    ) -> TargetPlan {
        let guard = self.item_index.lock().expect("item index mutex poisoned");
        guard.plan_target(list_id, target_index, is_live, exclude)
    }

    /// Set or clear an item's done state. Independent of `binned` —
    /// flipping done leaves `binned_at` untouched. Order containers are
    /// untouched: a hidden item's entry stays in place so restore
    /// returns it to exactly its former position.
    pub fn set_item_done(&self, item_id: &str, done: bool) -> Result<(), DocError> {
        let map = self.find_item(item_id)?;
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
        let live_index = self.sync_item_liveness(item_id, &map);
        self.push_event(AppEvent::ItemStatusChanged {
            id: item_id.to_string(),
            done_at: new_done,
            binned_at,
            live_index,
        });
        Ok(())
    }

    /// Set or clear done state for many items in one commit. Surgical
    /// below `BULK_STATUS_EVENT_THRESHOLD`: work is proportional to the
    /// touched items' lists, never total doc size. At/above the
    /// threshold it falls back to one rebuild + diff.
    pub fn set_items_done(&self, item_ids: &[&str], done: bool) -> Result<(), DocError> {
        self.set_items_status(item_ids, done, KEY_DONE_AT)
    }

    /// Set or clear an item's binned state. Independent of `done` —
    /// binning a done item keeps it done; restoring (unbinning) leaves
    /// the done state alone.
    pub fn set_item_binned(&self, item_id: &str, binned: bool) -> Result<(), DocError> {
        let map = self.find_item(item_id)?;
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
        let live_index = self.sync_item_liveness(item_id, &map);
        self.push_event(AppEvent::ItemStatusChanged {
            id: item_id.to_string(),
            done_at,
            binned_at: new_binned,
            live_index,
        });
        Ok(())
    }

    /// Set or clear binned state for many items in one commit.
    /// Surgical / bulk-fallback split for the same reason as
    /// `set_items_done`.
    pub fn set_items_binned(&self, item_ids: &[&str], binned: bool) -> Result<(), DocError> {
        self.set_items_status(item_ids, binned, KEY_BINNED_AT)
    }

    fn set_items_status(&self, item_ids: &[&str], on: bool, key: &str) -> Result<(), DocError> {
        if item_ids.is_empty() {
            return Ok(());
        }
        assert_unique_item_ids(item_ids)?;
        let pre_items = (item_ids.len() >= BULK_STATUS_EVENT_THRESHOLD)
            .then(|| self.iter_items().collect::<Vec<ItemView>>());
        // Resolve everything up front so an unknown id errors before
        // any map is touched.
        let maps: Vec<(&str, LoroMap)> = item_ids
            .iter()
            .map(|id| self.find_item(id).map(|map| (*id, map)))
            .collect::<Result<_, _>>()?;
        let mut changed: Vec<(&str, LoroMap, Option<i64>)> = Vec::new();
        for (item_id, map) in maps {
            let prev = read_i64(&map, key);
            let new = match (on, prev) {
                (true, Some(_)) | (false, None) => continue,
                (true, None) => Some(now_millis()),
                (false, Some(_)) => None,
            };
            match new {
                Some(t) => {
                    map.insert(key, t)?;
                }
                None => {
                    let _ = map.delete(key);
                }
            }
            changed.push((item_id, map, new));
        }
        if changed.is_empty() {
            return Ok(());
        }
        self.inner.commit();
        if let Some(pre) = pre_items {
            self.rebuild_index();
            self.emit_item_diffs(&pre);
            return Ok(());
        }
        for (item_id, map, new) in changed {
            let live_index = self.sync_item_liveness(item_id, &map);
            let (done_at, binned_at) = if key == KEY_DONE_AT {
                (new, read_i64(&map, KEY_BINNED_AT))
            } else {
                (read_i64(&map, KEY_DONE_AT), new)
            };
            self.push_event(AppEvent::ItemStatusChanged {
                id: item_id.to_string(),
                done_at,
                binned_at,
                live_index,
            });
        }
        Ok(())
    }

    /// Refresh the index after an item's done/binned flags changed.
    /// Returns the item's live index within its list (`None` when
    /// hidden). Hiding is an O(live) splice; a restore recomputes the
    /// list's projection to find the re-entry position.
    fn sync_item_liveness(&self, item_id: &str, map: &LoroMap) -> Option<usize> {
        let live_now = is_in_list_view(map);
        let mut guard = self.item_index.lock().expect("item index mutex poisoned");
        let (list_id, was_live) = {
            let m = guard.meta.get_mut(item_id)?;
            let was = m.live;
            m.live = live_now;
            (m.list_id.clone(), was)
        };
        if !live_now {
            guard.splice_live_out(&list_id, item_id);
            return None;
        }
        if was_live {
            // live → live (no transition): position unchanged.
            return guard
                .live_by_list
                .get(&list_id)
                .and_then(|arr| arr.iter().position(|x| x == item_id));
        }
        let live = guard.refresh_live(&list_id);
        live.iter().position(|x| x == item_id)
    }

    pub fn delete_binned(&self, item_id: &str) -> Result<(), DocError> {
        self.delete_binned_items(&[item_id])
    }

    /// Hard-delete the subset of binned items identified by `item_ids`
    /// in one commit. Errors if any id is not currently binned.
    /// Deletes the item map from `items` and best-effort removes the
    /// item's entries from its located order container.
    pub fn delete_binned_items(&self, item_ids: &[&str]) -> Result<(), DocError> {
        if item_ids.is_empty() {
            return Ok(());
        }
        assert_unique_item_ids(item_ids)?;
        for item_id in item_ids {
            let map = self.find_item(item_id)?;
            if read_i64(&map, KEY_BINNED_AT).is_none() {
                return Err(DocError::NotBinned);
            }
        }
        self.hard_delete_items(item_ids)
    }

    /// Hard-deletes every binned item. Returns how many were removed.
    pub fn empty_bin(&self) -> Result<usize, DocError> {
        let binned: Vec<String> = self
            .iter_items()
            .filter(|i| i.is_binned())
            .map(|i| i.id)
            .collect();
        if binned.is_empty() {
            return Ok(0);
        }
        let refs: Vec<&str> = binned.iter().map(String::as_str).collect();
        self.hard_delete_items(&refs)?;
        Ok(binned.len())
    }

    /// Shared hard-delete path: remove item maps + their order entries
    /// in one commit, then update the index and emit `ItemRemoved`s.
    /// Callers have already validated the ids.
    fn hard_delete_items(&self, item_ids: &[&str]) -> Result<(), DocError> {
        // Entry positions + visibility per item, gathered before any
        // mutation. `per_item` rows are (item_id, list_id, was_visible).
        type PerItem = Vec<(String, String, bool)>;
        let (per_list, per_item): (HashMap<String, Vec<usize>>, PerItem) = {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            let mut acc: HashMap<String, Vec<usize>> = HashMap::new();
            let mut per_item = Vec::with_capacity(item_ids.len());
            for item_id in item_ids {
                let Some(m) = guard.meta.get(*item_id) else {
                    continue;
                };
                acc.entry(m.list_id.clone())
                    .or_default()
                    .extend(guard.entry_positions(&m.list_id, item_id));
                per_item.push((
                    (*item_id).to_string(),
                    m.list_id.clone(),
                    guard.canonical_raw_pos(&m.list_id, item_id).is_some(),
                ));
            }
            for positions in acc.values_mut() {
                positions.sort_unstable();
                positions.dedup();
            }
            (acc, per_item)
        };
        let items = self.items();
        for item_id in item_ids {
            items.delete(item_id)?;
        }
        for (list_id, positions) in &per_list {
            let order = self.order_list(list_id);
            for p in positions.iter().rev() {
                order.delete(*p, 1)?;
            }
        }
        self.inner.commit();
        {
            let mut guard = self.item_index.lock().expect("item index mutex poisoned");
            for item_id in item_ids {
                guard.remove_item(item_id);
            }
            for (list_id, positions) in &per_list {
                if let Some(raw) = guard.raw_orders.get_mut(list_id) {
                    for p in positions.iter().rev() {
                        if *p < raw.len() {
                            raw.remove(*p);
                        }
                    }
                }
            }
            // Removals are exact: splice out of the live arrays and
            // drop visible counts — no projection walk needed.
            for (item_id, list_id, was_visible) in &per_item {
                guard.splice_live_out(list_id, item_id);
                if *was_visible {
                    guard.bump_visible(list_id, -1);
                }
            }
        }
        for item_id in item_ids {
            self.push_event(AppEvent::ItemRemoved {
                id: (*item_id).to_string(),
            });
        }
        Ok(())
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

    /// Toggle the global "show counts on non-Queue lists" setting. Queue
    /// is unaffected — its count is always visible (subject to count >
    /// 0) and is not gated by this flag. No-op when the value is
    /// unchanged, so flicking the menu twice doesn't emit phantom
    /// events or undo steps.
    pub fn set_show_list_counts(&self, show: bool) -> Result<(), DocError> {
        let settings = self.settings_map();
        let current = read_bool(&settings, KEY_SHOW_LIST_COUNTS).unwrap_or(true);
        if current == show {
            return Ok(());
        }
        if show {
            // Drop the key entirely on the on path so the default state
            // leaves no trace — on-disk state matches a never-toggled doc.
            settings.delete(KEY_SHOW_LIST_COUNTS)?;
        } else {
            settings.insert(KEY_SHOW_LIST_COUNTS, false)?;
        }
        self.inner.commit();
        let post = settings_view(&settings);
        self.push_event(AppEvent::SettingsChanged {
            show_list_counts: post.show_list_counts,
            main_name: post.main_name,
        });
        Ok(())
    }

    /// Set or clear the reserved `main` (Queue) list's display-name
    /// override. Trims `name`; an empty trimmed string clears the
    /// override (so clients fall back to the localized built-in label).
    /// No-op when the resulting value matches the current value, so
    /// repeat saves of the same name don't emit phantom events.
    pub fn set_main_name(&self, name: &str) -> Result<(), DocError> {
        let settings = self.settings_map();
        let trimmed = name.trim();
        let next: Option<String> = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
        let current = read_string(&settings, KEY_MAIN_NAME);
        if current.as_deref() == next.as_deref() {
            return Ok(());
        }
        match &next {
            Some(s) => settings.insert(KEY_MAIN_NAME, s.as_str())?,
            None => settings.delete(KEY_MAIN_NAME)?,
        }
        self.inner.commit();
        let post = settings_view(&settings);
        self.push_event(AppEvent::SettingsChanged {
            show_list_counts: post.show_list_counts,
            main_name: post.main_name,
        });
        Ok(())
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

    /// Refuses for the always-on `main` list. Every item locating to
    /// the deleted list (live, done and binned) is moved to `main` with
    /// a fresh placement, appended to `order/main` in the deleted
    /// list's resolved order. The abandoned order container remains as
    /// unreachable history.
    pub fn delete_list(&self, list_id: &str) -> Result<(), DocError> {
        if list_id == LIST_MAIN {
            return Err(DocError::CannotDeleteBuiltin(LIST_MAIN.into()));
        }
        let (idx, _) = self.find_list(list_id)?;
        let resolved = {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            guard.project(list_id).0
        };
        let main_order = self.order_list(LIST_MAIN);
        for item_id in &resolved {
            let map = self.find_item(item_id)?;
            let placement = new_id();
            map.insert(
                KEY_LOCATION,
                Location {
                    list_id: LIST_MAIN.to_string(),
                    placement_id: placement.clone(),
                }
                .encode()
                .as_str(),
            )?;
            main_order.push(
                OrderEntry {
                    item_id: item_id.clone(),
                    placement_id: placement,
                }
                .encode()
                .as_str(),
            )?;
        }
        self.lists().delete(idx, 1)?;
        self.inner.commit();
        // Rare operation; a wholesale rebuild is simpler than patching
        // two lists' shadows plus membership.
        self.rebuild_index();
        let main_positions: HashMap<String, usize> = {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            guard
                .live_by_list
                .get(LIST_MAIN)
                .map(|ids| {
                    ids.iter()
                        .enumerate()
                        .map(|(i, id)| (id.clone(), i))
                        .collect()
                })
                .unwrap_or_default()
        };
        for id in resolved {
            let live_index = main_positions.get(&id).copied();
            self.push_event(AppEvent::ItemListChanged {
                id,
                list_id: LIST_MAIN.to_string(),
                live_index,
            });
        }
        self.push_event(AppEvent::ListRemoved {
            id: list_id.to_string(),
        });
        Ok(())
    }

    /// Explicit, idempotent order-entry repair (never run implicitly by
    /// reads): removes stale and duplicate entries and materializes
    /// real entries for fallback-tail items, in one commit. Returns the
    /// number of repairs; `0` means the doc was clean and nothing was
    /// committed. Visible projections are unchanged by construction, so
    /// no events are emitted.
    pub fn reconcile(&self) -> Result<usize, DocError> {
        struct ListPlan {
            stale: Vec<usize>,
            /// (item_id, placement_id) entries to append for
            /// fallback-tail items, in deterministic tail order.
            append: Vec<OrderEntry>,
        }
        // Items with a missing/unparseable location get a fresh one
        // written (main + new placement) plus a matching entry.
        let mut fix_location: Vec<(String, String)> = Vec::new();
        let mut plans: HashMap<String, ListPlan> = HashMap::new();
        {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            let mut lists: HashSet<&String> = guard.raw_orders.keys().collect();
            lists.extend(guard.members.keys());
            for list_id in lists {
                let mut seen = HashSet::new();
                let mut stale = Vec::new();
                for (i, entry) in guard
                    .raw_orders
                    .get(list_id)
                    .map(Vec::as_slice)
                    .unwrap_or(&[])
                    .iter()
                    .enumerate()
                {
                    let visible = entry.as_ref().is_some_and(|e| {
                        guard.meta.get(&e.item_id).is_some_and(|m| {
                            m.list_id == *list_id && m.placement_id == e.placement_id
                        }) && seen.insert(e.item_id.clone())
                    });
                    if !visible {
                        stale.push(i);
                    }
                }
                // Fallback tail in its deterministic order.
                let mut tail: Vec<&String> = guard
                    .members
                    .get(list_id)
                    .into_iter()
                    .flatten()
                    .filter(|id| !seen.contains(*id))
                    .collect();
                tail.sort_by(|a, b| {
                    let (ma, mb) = (&guard.meta[*a], &guard.meta[*b]);
                    ma.created_at.cmp(&mb.created_at).then_with(|| a.cmp(b))
                });
                let mut append = Vec::new();
                for id in tail {
                    let m = &guard.meta[id];
                    if m.placement_id.is_empty() {
                        let placement = new_id();
                        fix_location.push((id.clone(), placement.clone()));
                        append.push(OrderEntry {
                            item_id: id.clone(),
                            placement_id: placement,
                        });
                    } else {
                        append.push(OrderEntry {
                            item_id: id.clone(),
                            placement_id: m.placement_id.clone(),
                        });
                    }
                }
                if !stale.is_empty() || !append.is_empty() {
                    plans.insert(list_id.clone(), ListPlan { stale, append });
                }
            }
        }
        if plans.is_empty() {
            return Ok(0);
        }
        let mut repairs = 0usize;
        for (item_id, placement) in &fix_location {
            let map = self.find_item(item_id)?;
            map.insert(
                KEY_LOCATION,
                Location {
                    list_id: LIST_MAIN.to_string(),
                    placement_id: placement.clone(),
                }
                .encode()
                .as_str(),
            )?;
        }
        for (list_id, plan) in &plans {
            let order = self.order_list(list_id);
            for p in plan.stale.iter().rev() {
                order.delete(*p, 1)?;
                repairs += 1;
            }
            for entry in &plan.append {
                order.push(entry.encode().as_str())?;
                repairs += 1;
            }
        }
        self.inner.commit();
        self.rebuild_index();
        Ok(repairs)
    }

    // ---------- reads ----------

    /// Items of one list in resolved order, all statuses except binned
    /// unless `include_binned`.
    pub fn items_in_list(&self, list_id: &str, include_binned: bool) -> Vec<ItemView> {
        let resolved = {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            guard.project(list_id).0
        };
        resolved
            .iter()
            .filter_map(|id| self.get_item(id))
            .filter(|i| include_binned || !i.is_binned())
            .collect()
    }

    pub fn binned_items(&self) -> Vec<ItemView> {
        self.iter_items().filter(|i| i.is_binned()).collect()
    }

    pub fn all_lists(&self) -> Vec<ListView> {
        let lists = self.lists();
        let mut out = Vec::with_capacity(lists.len());
        for i in 0..lists.len() {
            if let Some(map) = list_map_at(&lists, i)
                && let Some(view) = list_view(&map)
            {
                out.push(view);
            }
        }
        out
    }

    pub fn get_settings(&self) -> SettingsView {
        settings_view(&self.settings_map())
    }

    /// Semantic full-account export. This is intentionally a compact,
    /// human-readable data dump rather than a CRDT/state backup. Items
    /// are emitted grouped per list in resolved order, so array order
    /// carries the ordering across the export/import boundary.
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

        let s = self.get_settings();
        JsonExport {
            version: 1,
            settings: ExportSettings {
                show_list_counts: s.show_list_counts,
                main_name: s.main_name,
            },
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

    /// Additive JSON import. Source lists are created as fresh user
    /// lists (new IDs); source items keep their text / notes /
    /// timestamps / done-binned state but get fresh IDs and placements
    /// and follow the id-map: anything in the source's `main` lands in
    /// the local `main`, builtin entries are not duplicated, and items
    /// whose `list_id` references a list not present in the export fall
    /// back to `main` (same orphan handling as `delete_list`).
    /// Existing local content is untouched. All writes land in a
    /// single Loro commit; UI events are emitted via the standard
    /// pre/post state-diff.
    pub fn import_json(&self, export: &JsonExport) -> Result<ImportSummary, DocError> {
        if export.version != 1 {
            return Err(DocError::Invalid(format!(
                "unsupported export version: {} (expected 1)",
                export.version
            )));
        }

        let pre_items: Vec<ItemView> = self.iter_items().collect();
        let pre_lists: Vec<ListView> = self.all_lists();
        let pre_settings = self.get_settings();

        let mut id_map: HashMap<String, String> = HashMap::new();
        id_map.insert(LIST_MAIN.to_string(), LIST_MAIN.to_string());

        let lists = self.lists();
        let mut lists_added: usize = 0;
        for src_list in &export.lists {
            if src_list.builtin || src_list.id == LIST_MAIN {
                id_map.insert(src_list.id.clone(), LIST_MAIN.to_string());
                continue;
            }
            let name = src_list.name.trim();
            if name.is_empty() {
                continue;
            }
            let new_list_id = new_id();
            let map = lists.push_container(LoroMap::new())?;
            let created_at = src_list.created_at.unwrap_or_else(now_millis);
            map.insert(KEY_ID, new_list_id.as_str())?;
            map.insert(KEY_NAME, name)?;
            map.insert(KEY_CREATED_AT, created_at)?;
            id_map.insert(src_list.id.clone(), new_list_id);
            lists_added += 1;
        }

        let items = self.items();
        let mut items_added: usize = 0;
        let mut items_skipped: usize = 0;
        for src_item in &export.items {
            let text = src_item.text.trim();
            if text.is_empty() {
                items_skipped += 1;
                continue;
            }
            let target_list_id = id_map
                .get(&src_item.list_id)
                .cloned()
                .unwrap_or_else(|| LIST_MAIN.to_string());
            let new_item_id = new_id();
            let placement = new_id();
            let map = items.insert_container(&new_item_id, LoroMap::new())?;
            map.insert(KEY_ID, new_item_id.as_str())?;
            map.insert(KEY_TEXT, text)?;
            map.insert(
                KEY_LOCATION,
                Location {
                    list_id: target_list_id.clone(),
                    placement_id: placement.clone(),
                }
                .encode()
                .as_str(),
            )?;
            map.insert(KEY_CREATED_AT, src_item.created_at)?;
            let notes = src_item.notes.trim();
            if !notes.is_empty() {
                map.insert(KEY_NOTES, notes)?;
            }
            if let Some(t) = src_item.done_at {
                map.insert(KEY_DONE_AT, t)?;
            }
            if let Some(t) = src_item.binned_at {
                map.insert(KEY_BINNED_AT, t)?;
            }
            self.order_list(&target_list_id).push(
                OrderEntry {
                    item_id: new_item_id,
                    placement_id: placement,
                }
                .encode()
                .as_str(),
            )?;
            items_added += 1;
        }

        self.inner.commit();
        self.rebuild_index();
        self.emit_state_diff(&pre_items, &pre_lists, &pre_settings);

        Ok(ImportSummary {
            lists_added,
            items_added,
            items_skipped,
        })
    }

    /// JSON-string convenience wrapper around `import_json` — what the
    /// web client hands the user-selected file contents to.
    pub fn import_json_str(&self, json: &str) -> Result<ImportSummary, DocError> {
        let export: JsonExport = serde_json::from_str(json)
            .map_err(|e| DocError::Invalid(format!("invalid JSON export: {e}")))?;
        self.import_json(&export)
    }

    pub fn get_item(&self, item_id: &str) -> Option<ItemView> {
        let map = self.find_item(item_id).ok()?;
        item_view(&map)
    }

    pub fn get_list_meta(&self, list_id: &str) -> Option<ListView> {
        let (_, map) = self.find_list(list_id).ok()?;
        list_view(&map)
    }

    /// Per-list nav view: ids of items in this list that are neither
    /// done nor binned, in resolved order.
    pub fn live_item_ids(&self, list_id: &str) -> Vec<String> {
        let guard = self.item_index.lock().expect("item index mutex poisoned");
        guard.live_by_list.get(list_id).cloned().unwrap_or_default()
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

    /// Materialize every item in canonical walk order: `main` first,
    /// then user lists in `lists` container order, then any orphan list
    /// ids (sorted) — each list in its resolved order. This grouped
    /// order is the deterministic replacement for the v1 global CRDT
    /// order; per-list consumers reconstruct their arrays from it.
    /// Intended for one-shot client attachment/resync snapshots; live
    /// mutation paths should use `AppEvent`s instead.
    pub fn all_items(&self) -> Vec<ItemView> {
        self.iter_items().collect()
    }

    /// Canonical list-id walk order backing `iter_items` — see
    /// [`Doc::all_items`].
    fn ordered_list_ids(&self) -> Vec<String> {
        let mut out = vec![LIST_MAIN.to_string()];
        let mut known: HashSet<String> = out.iter().cloned().collect();
        for list in self.all_lists() {
            if known.insert(list.id.clone()) {
                out.push(list.id);
            }
        }
        let mut orphans: Vec<String> = {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            guard
                .members
                .keys()
                .filter(|l| !known.contains(*l))
                .cloned()
                .collect()
        };
        orphans.sort();
        out.extend(orphans);
        out
    }

    fn iter_items(&self) -> impl Iterator<Item = ItemView> + '_ {
        let mut ids: Vec<String> = Vec::new();
        for list_id in self.ordered_list_ids() {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            ids.extend(guard.project(&list_id).0);
        }
        ids.into_iter().filter_map(move |id| self.get_item(&id))
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

    /// Encoded current oplog VersionVector. The browser oplog adapter
    /// (`spec/local-storage.md`) keeps the VV captured after the previous
    /// commit and asks for everything strictly after it on the next
    /// commit — that delta is what the oplog row stores.
    pub fn oplog_vv_bytes(&self) -> Vec<u8> {
        self.inner.oplog_vv().encode()
    }

    /// Export Loro updates strictly after `from_vv_bytes`. Returns the
    /// raw plaintext update blob (the JS layer encrypts it before
    /// writing to IndexedDB). Decoupled from `pending_export` because
    /// the oplog frontier is independent of the sync push frontier — a
    /// freshly committed local op needs to land in the oplog before it's
    /// considered durable, regardless of whether the server has it.
    pub fn export_updates_after_bytes(&self, from_vv_bytes: &[u8]) -> Result<Vec<u8>, DocError> {
        // Empty input means "from genesis" — convenient cursor for the
        // first oplog append on a fresh-signup boot, before any
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

    /// Apply one oplog replay blob without rebuilding disposable indexes.
    /// Boot callers replay every stored blob through this method and call
    /// [`Doc::finish_oplog_replay`] exactly once afterward, avoiding an
    /// O(items × replay_rows) index rebuild.
    ///
    /// Tagged `"remote"` so the per-session UndoManager skips historical
    /// operations; reloading a tab must not resurrect undoable steps.
    pub fn replay_oplog_update(&mut self, plaintext: &[u8]) -> Result<(), DocError> {
        self.inner.import_with(plaintext, "remote")?;
        Ok(())
    }

    /// Finalize a silent boot replay. Rebuilds the disposable item index
    /// once after every snapshot/tail blob has landed and discards any
    /// domain events: historical state is materialized explicitly by the
    /// attaching UI, not presented as live mutations.
    pub fn finish_oplog_replay(&self) {
        self.rebuild_index();
        if let Ok(mut capture) = self.diff_capture.lock() {
            capture.mode = DiffCaptureMode::None;
            capture.diffs.clear();
        }
        if let Ok(mut events) = self.events.lock() {
            events.clear();
        }
    }

    /// Convenience for a one-blob replay. Multi-row boot paths should use
    /// [`Doc::replay_oplog_update`] + [`Doc::finish_oplog_replay`] instead.
    ///
    /// Does *not* advance `last_pushed_vv`. Whether the original local
    /// commit reached the server before the crash is unknowable from
    /// disk; the next push retries, and Loro / the server dedupe.
    pub fn import_oplog_updates(&mut self, plaintext: &[u8]) -> Result<(), DocError> {
        self.replay_oplog_update(plaintext)?;
        self.finish_oplog_replay();
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
    /// Translates the import's Loro container diffs (captured by the
    /// root subscription) into per-id `AppEvent`s, so a frame's cost is
    /// proportional to the ops it carries — never total doc size. Any
    /// diff shape the translator can't handle (or a bulk frame touching
    /// ≥ `DIFF_TRANSLATE_MAX_DIRTY` items) rebuilds the disposable index
    /// once and emits one `FullResync` control event.
    pub fn apply_remote(&mut self, dek: &Dek, blob: &EncryptedBlob) -> Result<(), DocError> {
        self.apply_remote_batch(dek, std::iter::once(blob))
    }

    /// Batch variant of [`Doc::apply_remote`]. Imports all blobs first,
    /// then translates once so catch-up batches don't pay per-op cost.
    pub fn apply_remote_batch<'a, I>(&mut self, dek: &Dek, blobs: I) -> Result<(), DocError>
    where
        I: IntoIterator<Item = &'a EncryptedBlob>,
    {
        let pre_lists: Vec<ListView> = self.all_lists();
        let pre_settings = self.get_settings();
        self.begin_diff_capture(DiffCaptureMode::Import);

        let result = blobs
            .into_iter()
            .try_for_each(|blob| self.import_remote_blob(dek, blob));
        let diffs = self.finish_diff_capture();
        if result.is_err() {
            // A batch may have applied earlier blobs before a later one
            // failed — resync events for whatever landed, then surface
            // the error.
            self.emit_diff_fallback();
            return result;
        }
        if self
            .translate_captured_diffs(diffs, &pre_lists, &pre_settings)
            .is_err()
        {
            self.emit_diff_fallback();
        }
        Ok(())
    }

    /// Translate captured import or undo diffs into surgical `AppEvent`s
    /// and incremental index updates. Errors are not failures — they
    /// mean "this frame is beyond the fast path" and the caller falls
    /// back to `emit_diff_fallback`. Phase 1 plans everything against
    /// clones (no state touched), so an abort leaves the index coherent
    /// for the fallback's pre/post reasoning.
    fn translate_captured_diffs(
        &self,
        diffs: Vec<CapturedDiff>,
        pre_lists: &[ListView],
        pre_settings: &SettingsView,
    ) -> Result<(), ()> {
        // ---- Phase 1: plan (read-only) ----
        let mut lists_dirty = false;
        let mut settings_dirty = false;
        let mut upserts = HashSet::<String>::new();
        let mut removals = HashSet::<String>::new();
        let mut map_dirty = HashMap::<ContainerID, HashSet<String>>::new();
        // list id → shadow clone with this frame's positional ops applied.
        let mut shadows = HashMap::<String, Vec<Option<OrderEntry>>>::new();
        // list id → item ids whose entries were (re)inserted this frame:
        // the actively-moved candidates for minimal event emission.
        let mut active: HashMap<String, HashSet<String>> = HashMap::new();
        let mut entry_churn = 0usize;

        {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            for diff in diffs {
                match diff {
                    CapturedDiff::Opaque => return Err(()),
                    CapturedDiff::Lists => lists_dirty = true,
                    CapturedDiff::Settings => settings_dirty = true,
                    CapturedDiff::ItemsRoot { upserted, removed } => {
                        upserts.extend(upserted);
                        removals.extend(removed);
                    }
                    CapturedDiff::ItemMap { container, keys } => {
                        map_dirty.entry(container).or_default().extend(keys);
                    }
                    CapturedDiff::Order { list_id, ops } => {
                        let shadow = shadows.entry(list_id.clone()).or_insert_with(|| {
                            guard.raw_orders.get(&list_id).cloned().unwrap_or_default()
                        });
                        let mut pos = 0usize;
                        for op in ops {
                            match op {
                                CapturedListItem::Retain(n) => {
                                    pos = pos.checked_add(n).ok_or(())?;
                                    if pos > shadow.len() {
                                        return Err(());
                                    }
                                }
                                CapturedListItem::Delete(n) => {
                                    if pos + n > shadow.len() {
                                        return Err(());
                                    }
                                    entry_churn += n;
                                    shadow.drain(pos..pos + n);
                                }
                                CapturedListItem::Insert(vals) => {
                                    for v in vals {
                                        let entry = v.as_deref().and_then(OrderEntry::parse);
                                        if let Some(e) = &entry {
                                            active
                                                .entry(list_id.clone())
                                                .or_default()
                                                .insert(e.item_id.clone());
                                        }
                                        shadow.insert(pos.min(shadow.len()), entry);
                                        pos += 1;
                                        entry_churn += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // A key both deleted and re-set within the frame coalesces to
        // its final state in the map diff; treat re-adds as upserts.
        removals.retain(|id| !upserts.contains(id));

        // The shadows must land exactly on the post-import containers,
        // or our positional reasoning was wrong somewhere — resync.
        for (list_id, shadow) in &shadows {
            if shadow.len() != self.order_list(list_id).len() {
                return Err(());
            }
        }

        // Resolve map-dirty containers to item ids. Upserted ids get
        // full-state events anyway; deleted containers are fine iff the
        // frame also removed them.
        let mut dirty_keys_by_id = HashMap::<String, HashSet<String>>::new();
        for (cid, keys) in map_dirty {
            let map = self.inner.get_map(cid);
            let Some(id) = read_string(&map, KEY_ID) else {
                continue;
            };
            if removals.contains(&id) || upserts.contains(&id) {
                continue;
            }
            dirty_keys_by_id.entry(id).or_default().extend(keys);
        }

        if upserts.len() + removals.len() + dirty_keys_by_id.len() + entry_churn
            >= DIFF_TRANSLATE_MAX_DIRTY
        {
            return Err(());
        }

        // Per-item change plan: old meta from the index, new meta from
        // the post-import doc.
        struct Change {
            old: Option<ItemMeta>,
            new: Option<ItemMeta>,
            keys: HashSet<String>,
            brand_new: bool,
        }
        let mut changes = HashMap::<String, Change>::new();
        {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            let items = self.items();
            for id in &upserts {
                let Some(map) = item_map_of(&items, id) else {
                    return Err(());
                };
                let old = guard.meta.get(id).cloned();
                let brand_new = old.is_none();
                // A re-set of an existing container (undo/redo shapes)
                // is translated as "everything may have changed".
                let keys: HashSet<String> = if brand_new {
                    HashSet::new()
                } else {
                    [
                        KEY_TEXT,
                        KEY_NOTES,
                        KEY_DONE_AT,
                        KEY_BINNED_AT,
                        KEY_LOCATION,
                    ]
                    .into_iter()
                    .map(str::to_string)
                    .collect()
                };
                changes.insert(
                    id.clone(),
                    Change {
                        old,
                        new: Some(item_meta(&map)),
                        keys,
                        brand_new,
                    },
                );
            }
            for (id, keys) in dirty_keys_by_id {
                let Some(map) = item_map_of(&items, &id) else {
                    return Err(());
                };
                changes.insert(
                    id.clone(),
                    Change {
                        old: guard.meta.get(&id).cloned(),
                        new: Some(item_meta(&map)),
                        keys,
                        brand_new: false,
                    },
                );
            }
            for id in &removals {
                changes.insert(
                    id.clone(),
                    Change {
                        old: guard.meta.get(id).cloned(),
                        new: None,
                        keys: HashSet::new(),
                        brand_new: false,
                    },
                );
            }
        }

        let mut affected: HashSet<String> = shadows.keys().cloned().collect();
        for c in changes.values() {
            if let Some(o) = &c.old {
                affected.insert(o.list_id.clone());
            }
            if let Some(n) = &c.new {
                affected.insert(n.list_id.clone());
            }
        }

        // ---- Phase 2: commit index ----
        let (pre_live, post_live) = {
            let mut guard = self.item_index.lock().expect("item index mutex poisoned");
            let pre: HashMap<String, Vec<String>> = affected
                .iter()
                .map(|l| {
                    (
                        l.clone(),
                        guard.live_by_list.get(l).cloned().unwrap_or_default(),
                    )
                })
                .collect();
            for (id, c) in &changes {
                match &c.new {
                    Some(m) => guard.set_meta(id, m.clone()),
                    None => guard.remove_item(id),
                }
            }
            for (l, shadow) in shadows {
                guard.raw_orders.insert(l, shadow);
            }
            let mut post = HashMap::new();
            for l in &affected {
                post.insert(l.clone(), guard.refresh_live(l));
            }
            (pre, post)
        };

        // ---- Phase 3: events ----
        let view_of = |id: &str| -> Result<ItemView, ()> {
            let map = item_map_of(&self.items(), id).ok_or(())?;
            item_view(&map).ok_or(())
        };

        let mut removals_sorted: Vec<&String> = removals.iter().collect();
        removals_sorted.sort();
        for id in removals_sorted {
            self.push_event(AppEvent::ItemRemoved { id: id.clone() });
        }

        // Content + hidden-side events, in id order so event sequences
        // are deterministic. Live-side positional events are emitted by
        // the per-list walk below.
        let mut change_ids: Vec<&String> = changes.keys().collect();
        change_ids.sort();
        for id in change_ids {
            let c = &changes[id];
            let Some(new) = &c.new else { continue };
            let has = |k: &str| c.keys.contains(k);
            if !c.brand_new {
                let view = view_of(id)?;
                if has(KEY_TEXT) {
                    self.push_event(AppEvent::ItemTextChanged {
                        id: id.clone(),
                        text: view.text.clone(),
                    });
                }
                if has(KEY_NOTES) {
                    self.push_event(AppEvent::ItemNotesChanged {
                        id: id.clone(),
                        notes: view.notes.clone(),
                    });
                }
            }
            let left_list = c.old.as_ref().is_some_and(|o| o.list_id != new.list_id);
            if new.live {
                // Live cross-list movers get their leave-signal *before*
                // any per-list walk: the consumer removes the item from
                // the source array now (appending it to the target), so
                // walks over the source list never reposition around a
                // ghost. The target walk repositions the item via an
                // ordinary `ItemMoved` candidate.
                if !c.brand_new && has(KEY_LOCATION) && left_list {
                    self.push_event(AppEvent::ItemListChanged {
                        id: id.clone(),
                        list_id: new.list_id.clone(),
                        live_index: None,
                    });
                }
                continue;
            }
            let view = view_of(id)?;
            if c.brand_new {
                self.push_event(AppEvent::ItemAdded {
                    id: view.id,
                    list_id: view.list_id,
                    text: view.text,
                    notes: view.notes,
                    created_at: view.created_at,
                    done_at: view.done_at,
                    binned_at: view.binned_at,
                    live_index: None,
                });
                continue;
            }
            if has(KEY_DONE_AT) || has(KEY_BINNED_AT) {
                self.push_event(AppEvent::ItemStatusChanged {
                    id: id.clone(),
                    done_at: view.done_at,
                    binned_at: view.binned_at,
                    live_index: None,
                });
            }
            if has(KEY_LOCATION) && left_list {
                self.push_event(AppEvent::ItemListChanged {
                    id: id.clone(),
                    list_id: new.list_id.clone(),
                    live_index: None,
                });
            }
        }

        // Per-list live walk: minimal ascending remove+insert event
        // plan, verified by replaying it the way a naive consumer does.
        let mut affected_sorted: Vec<&String> = affected.iter().collect();
        affected_sorted.sort();
        let mut planned: Vec<(usize, String, AppEvent)> = Vec::new();
        for list in affected_sorted {
            let pre = &pre_live[list.as_str()];
            let post = &post_live[list.as_str()];
            let post_set: HashSet<&String> = post.iter().collect();
            let base: Vec<&String> = pre.iter().filter(|id| post_set.contains(id)).collect();
            let post_pos: HashMap<&String, usize> =
                post.iter().enumerate().map(|(i, id)| (id, i)).collect();

            // Insert-type ids: not in the consumer's array yet; their
            // typed event both inserts and positions them.
            let mut insert_type: HashMap<&String, AppEvent> = HashMap::new();
            for (i, id) in post.iter().enumerate() {
                let Some(c) = changes.get(id) else { continue };
                let Some(new) = &c.new else { continue };
                if !new.live || new.list_id != *list {
                    continue;
                }
                if c.brand_new {
                    let view = view_of(id)?;
                    insert_type.insert(
                        id,
                        AppEvent::ItemAdded {
                            id: view.id,
                            list_id: view.list_id,
                            text: view.text,
                            notes: view.notes,
                            created_at: view.created_at,
                            done_at: view.done_at,
                            binned_at: view.binned_at,
                            live_index: Some(i),
                        },
                    );
                    continue;
                }
                // Hidden→live restores insert here. Cross-list movers
                // are *not* insert-type: their pre-walk leave-signal
                // `ItemListChanged` already appended them to this list
                // on the consumer, so an `ItemMoved` candidate
                // repositions them like any other id.
                let shown = c.old.as_ref().is_some_and(|o| !o.live);
                if shown && (c.keys.contains(KEY_DONE_AT) || c.keys.contains(KEY_BINNED_AT)) {
                    let view = view_of(id)?;
                    insert_type.insert(
                        id,
                        AppEvent::ItemStatusChanged {
                            id: id.clone(),
                            done_at: view.done_at,
                            binned_at: view.binned_at,
                            live_index: Some(i),
                        },
                    );
                }
            }

            // Candidate move set: start minimal (this frame's actively
            // re-inserted entries), widen to every position-changed id
            // if the minimal replay doesn't reconstruct the post state.
            // The simulation models the consumer exactly: one
            // remove-then-insert-at-live_index per event, applied
            // sequentially in emission (ascending post) order.
            let simulate = |cands: &HashSet<&String>| -> bool {
                let mut arr: Vec<&String> = base
                    .iter()
                    .filter(|id| !insert_type.contains_key(**id))
                    .copied()
                    .collect();
                let mut ops: Vec<(usize, &String)> = insert_type
                    .keys()
                    .copied()
                    .chain(cands.iter().copied())
                    .filter_map(|id| post_pos.get(id).map(|p| (*p, id)))
                    .collect();
                ops.sort_unstable();
                ops.dedup();
                for (p, id) in ops {
                    arr.retain(|x| *x != id);
                    arr.insert(p.min(arr.len()), id);
                }
                arr.len() == post.len() && arr.iter().zip(post.iter()).all(|(a, b)| *a == b)
            };

            let minimal: HashSet<&String> = active
                .get(list.as_str())
                .into_iter()
                .flatten()
                .filter(|id| post_set.contains(*id) && !insert_type.contains_key(*id))
                .collect();
            let candidates = if simulate(&minimal) {
                minimal
            } else {
                // Widen to every id whose surviving-relative position
                // changed; ascending remove+insert of that whole set is
                // the proven reconstruction. Bail to FullResync when
                // the event volume would exceed the surgical budget or
                // the replay still doesn't line up.
                let base_pos: HashMap<&String, usize> =
                    base.iter().enumerate().map(|(i, id)| (*id, i)).collect();
                let mut widened = HashSet::new();
                for (i, id) in post.iter().enumerate() {
                    if insert_type.contains_key(id) {
                        continue;
                    }
                    if base_pos.get(id).copied() != Some(i) {
                        widened.insert(id);
                    }
                }
                if widened.len() + planned.len() >= DIFF_TRANSLATE_MAX_DIRTY {
                    return Err(());
                }
                if !simulate(&widened) {
                    return Err(());
                }
                widened
            };

            for (i, id) in post.iter().enumerate() {
                if let Some(ev) = insert_type.remove(id) {
                    planned.push((i, list.clone(), ev));
                } else if candidates.contains(id) {
                    planned.push((
                        i,
                        list.clone(),
                        AppEvent::ItemMoved {
                            id: id.clone(),
                            live_index: Some(i),
                        },
                    ));
                }
            }
        }
        if planned.len() + removals.len() >= DIFF_TRANSLATE_MAX_DIRTY {
            return Err(());
        }
        for (_, _, ev) in planned {
            self.push_event(ev);
        }

        if lists_dirty || settings_dirty {
            let mut emitted = Vec::new();
            if settings_dirty {
                diff_settings(pre_settings, &self.get_settings(), &mut emitted);
            }
            if lists_dirty {
                diff_lists(pre_lists, &self.all_lists(), &mut emitted);
            }
            for ev in emitted {
                self.push_event(ev);
            }
        }
        Ok(())
    }

    /// Whole-doc fallback for frames the translator declined. Rebuild the
    /// disposable index, then emit one control signal. Consumers fetch the
    /// current snapshot once; they are never flooded with N synthetic adds.
    fn emit_diff_fallback(&self) {
        self.rebuild_index();
        let mut events = self.events.lock().expect("events mutex poisoned");
        events.clear();
        events.push_back(AppEvent::FullResync);
    }

    // ---------- undo / redo ----------

    /// Undo the most recent eligible local commit. Remote-applied ops
    /// are filtered out by origin prefix and never enter the stack.
    /// Returns `true` if a step was applied. Loro's emitted container
    /// diffs are translated into surgical `AppEvent`s; unusual or bulk
    /// shapes retain the whole-document correctness fallback.
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
        let pre_lists: Vec<ListView> = self.all_lists();
        let pre_settings = self.get_settings();
        self.begin_diff_capture(DiffCaptureMode::Undo);
        let result = {
            let mut um = self.undo.lock().expect("undo mutex poisoned");
            op(&mut um)
        };
        let diffs = self.finish_diff_capture();
        let did = result?;
        if did
            && self
                .translate_captured_diffs(diffs, &pre_lists, &pre_settings)
                .is_err()
        {
            self.emit_diff_fallback();
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
        let s = self.get_settings();
        out.push(AppEvent::SettingsChanged {
            show_list_counts: s.show_list_counts,
            main_name: s.main_name,
        });
        for (idx, list) in self.all_lists().into_iter().enumerate() {
            out.push(AppEvent::ListAdded {
                id: list.id,
                name: list.name,
                created_at: list.created_at,
                index: idx,
            });
        }
        // Walking the canonical grouped order means a per-list counter
        // yields each live item's position in its list's live projection.
        let mut live_counters = HashMap::<String, usize>::new();
        for item in self.iter_items() {
            let live_index = if item.is_in_list_view() {
                let counter = live_counters.entry(item.list_id.clone()).or_insert(0);
                let i = *counter;
                *counter += 1;
                Some(i)
            } else {
                None
            };
            out.push(AppEvent::ItemAdded {
                id: item.id,
                list_id: item.list_id,
                text: item.text,
                notes: item.notes,
                created_at: item.created_at,
                done_at: item.done_at,
                binned_at: item.binned_at,
                live_index,
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

    /// Serialize doc state + last-pushed VV. Encoding is msgpack —
    /// small, additively evolvable, and matches the wire format used
    /// everywhere else.
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
        let item_index = Mutex::new(ProjectionIndex::default());
        // Subscribe *after* the snapshot import so the boot state
        // doesn't land in the gated diff buffer as one giant frame.
        let diff_capture = Arc::new(Mutex::new(DiffCapture::default()));
        let _diff_sub = inner.subscribe_root(make_diff_subscriber(diff_capture.clone()));
        let doc = Self {
            inner,
            last_pushed_vv,
            events: Mutex::new(VecDeque::new()),
            item_index,
            undo,
            diff_capture,
            _diff_sub,
        };
        doc.rebuild_index();
        Ok(doc)
    }

    // ---------- fingerprint ----------

    /// Logical-state hash. Stable across replicas at logical equality;
    /// used for convergence assertions in tests. Snapshot bytes are
    /// *not* stable (Loro stores per-replica metadata), so we hash a
    /// canonical serialization of the visible item / list state. Items
    /// are hashed in the canonical grouped walk (`all_items`) so each
    /// list's resolved order — including hidden items' restore
    /// positions — is part of the hash.
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        let settings = self.get_settings();
        hasher.update(b"S");
        hasher.update([settings.show_list_counts as u8]);
        // `main_name` is `Option<String>`; hash a presence byte so an
        // empty string and `None` (which the reader collapses anyway)
        // can't collide with a non-empty value of the same bytes.
        match &settings.main_name {
            Some(n) => {
                hasher.update([1u8]);
                hash_str(&mut hasher, n);
            }
            None => hasher.update([0u8]),
        }
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
        // Items: canonical grouped walk order.
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

    fn items(&self) -> LoroMap {
        self.inner.get_map(ROOT_ITEMS)
    }

    fn lists(&self) -> LoroMovableList {
        self.inner.get_movable_list(ROOT_LISTS)
    }

    fn settings_map(&self) -> LoroMap {
        self.inner.get_map(ROOT_SETTINGS)
    }

    fn order_list(&self, list_id: &str) -> LoroMovableList {
        self.inner
            .get_movable_list(order_root_name(list_id).as_str())
    }

    /// Item container lookup, gated on the disposable index so a doc
    /// mid-boot-replay reports "not found" until `finish_oplog_replay`
    /// materializes state (deliberate: see the deferred-replay test).
    fn find_item(&self, item_id: &str) -> Result<LoroMap, DocError> {
        {
            let guard = self.item_index.lock().expect("item index mutex poisoned");
            if !guard.meta.contains_key(item_id) {
                return Err(DocError::ItemNotFound(item_id.to_string()));
            }
        }
        item_map_of(&self.items(), item_id)
            .ok_or_else(|| DocError::ItemNotFound(item_id.to_string()))
    }

    fn find_list(&self, list_id: &str) -> Result<(usize, LoroMap), DocError> {
        let lists = self.lists();
        for i in 0..lists.len() {
            if let Some(map) = list_map_at(&lists, i)
                && read_string(&map, KEY_ID).as_deref() == Some(list_id)
            {
                return Ok((i, map));
            }
        }
        Err(DocError::ListNotFound(list_id.into()))
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

    fn emit_state_diff(
        &self,
        pre_items: &[ItemView],
        pre_lists: &[ListView],
        pre_settings: &SettingsView,
    ) {
        let post_items: Vec<ItemView> = self.iter_items().collect();
        let post_lists: Vec<ListView> = self.all_lists();
        let post_settings = self.get_settings();
        let mut emitted = Vec::new();
        diff_settings(pre_settings, &post_settings, &mut emitted);
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
    // `LIST_MAIN` is a *reserved id*, not a ListMeta row — items
    // reference it as the string "main" and clients render its label
    // client-side. Touch the root containers so fresh docs keep the
    // same top-level shape; no ops are emitted for untouched roots.
    let _ = doc.get_map(ROOT_ITEMS);
    let _ = doc.get_movable_list(ROOT_LISTS);
    let _ = doc.get_map(ROOT_SETTINGS);
    let _ = doc.get_movable_list(order_root_name(LIST_MAIN).as_str());
    Ok(false)
}

fn item_map_of(items: &LoroMap, item_id: &str) -> Option<LoroMap> {
    match items.get(item_id)? {
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

fn scalar_entry_at(order: &LoroMovableList, idx: usize) -> Option<OrderEntry> {
    match order.get(idx)? {
        ValueOrContainer::Value(v) => v
            .into_string()
            .ok()
            .and_then(|s| OrderEntry::parse(s.as_ref())),
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

fn read_bool(map: &LoroMap, key: &str) -> Option<bool> {
    let v = map.get(key)?;
    let value = v.as_value()?.clone();
    value.into_bool().ok()
}

fn settings_view(map: &LoroMap) -> SettingsView {
    SettingsView {
        // Defaults on: a never-toggled doc shows counts. The key is only
        // persisted on the opt-out path (stored `false`); absence means
        // the default.
        show_list_counts: read_bool(map, KEY_SHOW_LIST_COUNTS).unwrap_or(true),
        // Read-side defaults to `None` when absent. Any persisted empty
        // string is treated the same — the mutation deletes the key on
        // empty input, but a caller that bypassed it shouldn't surface
        // a confusing blank label.
        main_name: read_string(map, KEY_MAIN_NAME).filter(|s| !s.is_empty()),
    }
}

/// Location/status slice used by the projection index. Items with a
/// missing or unparseable `location` deterministically project into
/// `main`'s fallback tail (empty placement never matches an entry) so
/// data is never hidden by a bad register.
fn item_meta(map: &LoroMap) -> ItemMeta {
    let (list_id, placement_id) = read_string(map, KEY_LOCATION)
        .and_then(|s| Location::parse(&s))
        .map(|l| (l.list_id, l.placement_id))
        .unwrap_or_else(|| (LIST_MAIN.to_string(), String::new()));
    ItemMeta {
        list_id,
        placement_id,
        live: is_in_list_view(map),
        created_at: read_i64(map, KEY_CREATED_AT).unwrap_or(0),
    }
}

fn item_view(map: &LoroMap) -> Option<ItemView> {
    let location = read_string(map, KEY_LOCATION)
        .and_then(|s| Location::parse(&s))
        .map(|l| l.list_id)
        .unwrap_or_else(|| LIST_MAIN.to_string());
    Some(ItemView {
        id: read_string(map, KEY_ID)?,
        text: read_string(map, KEY_TEXT)?,
        notes: read_string(map, KEY_NOTES).unwrap_or_default(),
        list_id: location,
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

fn is_in_list_view(map: &LoroMap) -> bool {
    read_i64(map, KEY_DONE_AT).is_none() && read_i64(map, KEY_BINNED_AT).is_none()
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
/// the transitions a UI store needs to mirror. Both slices are in the
/// canonical grouped walk order (`all_items`), so walking `post` with a
/// per-list counter reproduces each list's live projection. Used by
/// bulk local mutations and `import_json`, where the cheapest path to
/// per-id deltas is "snapshot before, snapshot after, walk both once."
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
    // Post-state live position per item id. Events emitted below are in
    // ascending post order, so a consumer applying
    // remove-then-insert-at-live_index per event converges on exactly
    // this projection.
    let mut live_counters = HashMap::<&str, usize>::new();
    let mut live_pos = HashMap::<&str, usize>::with_capacity(post.len());
    for it in post {
        if it.is_in_list_view() {
            let counter = live_counters.entry(it.list_id.as_str()).or_insert(0);
            live_pos.insert(it.id.as_str(), *counter);
            *counter += 1;
        }
    }

    for it in pre {
        if !post_by_id.contains_key(it.id.as_str()) {
            out.push(AppEvent::ItemRemoved { id: it.id.clone() });
        }
    }
    for (post_idx, post_it) in post.iter().enumerate() {
        let live_index = live_pos.get(post_it.id.as_str()).copied();
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
                    live_index,
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
                        live_index,
                    });
                }
                if pre_it.list_id != post_it.list_id {
                    out.push(AppEvent::ItemListChanged {
                        id: post_it.id.clone(),
                        list_id: post_it.list_id.clone(),
                        live_index,
                    });
                }
                if pre_idx != post_idx {
                    out.push(AppEvent::ItemMoved {
                        id: post_it.id.clone(),
                        live_index,
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

fn diff_settings(pre: &SettingsView, post: &SettingsView, out: &mut Vec<AppEvent>) {
    if pre != post {
        out.push(AppEvent::SettingsChanged {
            show_list_counts: post.show_list_counts,
            main_name: post.main_name.clone(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::Dek;

    /// The incremental index must always agree with a from-scratch
    /// recompute off the Loro containers.
    fn assert_live_projection_matches_doc(doc: &Doc) {
        let fresh = doc.compute_index();
        let guard = doc.item_index.lock().expect("item index mutex poisoned");
        assert_eq!(
            guard.live_by_list, fresh.live_by_list,
            "live_by_list out of sync with doc"
        );
        assert_eq!(
            guard.raw_orders, fresh.raw_orders,
            "raw order shadow out of sync with doc"
        );
        assert_eq!(guard.meta, fresh.meta, "item meta out of sync with doc");
        assert_eq!(
            guard.visible_counts, fresh.visible_counts,
            "visible-entry counts out of sync with doc"
        );
    }

    /// Not a correctness test — a quick order-of-magnitude probe for
    /// the per-mutation cost terms at a realistic lifetime-item count.
    /// Run with:
    ///   cargo test -p airday-core --release bench_mutation_terms_at_13k -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_mutation_terms_at_13k() {
        use std::time::Instant;
        let dek = Dek::generate();
        let doc = Doc::new().unwrap();
        // ~13k lifetime items: 200 live in main, the rest done — the
        // user-reported shape (many small lists, large Done history).
        let texts: Vec<String> = (0..13_000).map(|i| format!("item number {i}")).collect();
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        let ids = doc.add_items_at(LIST_MAIN, &refs, 0).unwrap();
        let done_refs: Vec<&str> = ids[..12_800].iter().map(String::as_str).collect();
        doc.set_items_done(&done_refs, true).unwrap();
        let _ = doc.drain_events();

        let t = Instant::now();
        let id = doc.add_item(LIST_MAIN, "one more").unwrap();
        println!("add_item:            {:?}", t.elapsed());

        let t = Instant::now();
        doc.set_item_done(&id, true).unwrap();
        println!("set_item_done:       {:?}", t.elapsed());

        let t = Instant::now();
        doc.set_items_binned(&[ids[12_900].as_str()], true).unwrap();
        println!("set_items_binned(1): {:?}", t.elapsed());

        let t = Instant::now();
        let blob = doc.pending_export(&dek).unwrap();
        println!(
            "pending_export:      {:?} ({} bytes)",
            t.elapsed(),
            blob.map(|b| b.ciphertext.len()).unwrap_or(0)
        );

        let t = Instant::now();
        let snap = doc.snapshot_blob(&dek).unwrap();
        println!(
            "snapshot_blob:       {:?} ({} bytes)",
            t.elapsed(),
            snap.ciphertext.len()
        );

        let t = Instant::now();
        let all: Vec<ItemView> = doc.iter_items().collect();
        println!(
            "iter_items.collect:  {:?} ({} items)",
            t.elapsed(),
            all.len()
        );

        let t = Instant::now();
        doc.rebuild_index();
        println!("rebuild_index:       {:?}", t.elapsed());
        let _ = doc.drain_events();

        // Match a real browser session: persisted history is loaded before
        // the user performs the move, so the UndoManager only owns the
        // current session's action rather than the 13k-item fixture setup.
        let saved = doc.save().unwrap();
        let doc = Doc::load(&saved).unwrap();
        doc.move_item(&ids[12_999], LIST_MAIN, 0).unwrap();
        let _ = doc.drain_events();
        let t = Instant::now();
        assert!(doc.undo().unwrap());
        println!("undo_move:            {:?}", t.elapsed());
        println!("  events emitted:    {}", doc.drain_events().len());
        let t = Instant::now();
        assert!(doc.redo().unwrap());
        println!("redo_move:            {:?}", t.elapsed());
        println!("  events emitted:    {}", doc.drain_events().len());

        let doc = Doc::load(&saved).unwrap();
        for (index, id) in ids[12_980..13_000].iter().enumerate() {
            doc.move_item(id, LIST_MAIN, index).unwrap();
        }
        let _ = doc.drain_events();
        let t = Instant::now();
        for _ in 0..20 {
            assert!(doc.undo().unwrap());
        }
        println!("undo_20_moves:         {:?}", t.elapsed());
        println!("  events emitted:    {}", doc.drain_events().len());

        // Remote-frame cost on a peer at the same size: one op in, how
        // long to apply + translate?
        let mut a = Doc::new().unwrap();
        let texts2: Vec<String> = (0..13_000).map(|i| format!("item number {i}")).collect();
        let refs2: Vec<&str> = texts2.iter().map(String::as_str).collect();
        let a_ids = a.add_items_at(LIST_MAIN, &refs2, 0).unwrap();
        let seed = a.pending_export(&dek).unwrap().unwrap();
        a.mark_pushed();
        let mut b = Doc::empty();
        b.apply_remote(&dek, &seed).unwrap();
        let _ = a.drain_events();
        let _ = b.drain_events();
        a.set_item_done(&a_ids[6_500], true).unwrap();
        let frame = a.pending_export(&dek).unwrap().unwrap();
        let t = Instant::now();
        b.apply_remote(&dek, &frame).unwrap();
        println!("apply_remote(1 op):  {:?}", t.elapsed());
        let evs = b.drain_events();
        println!("  events emitted:    {}", evs.len());
    }

    #[test]
    fn new_doc_has_no_persisted_lists() {
        // Main is a reserved id with no ListMeta row, and there are no
        // seeded user lists.
        let doc = Doc::new().unwrap();
        let lists = doc.all_lists();
        assert!(lists.is_empty());
        assert!(!lists.iter().any(|l| l.id == LIST_MAIN));
    }

    #[test]
    fn add_item_to_main_works_without_list_meta_row() {
        // `LIST_MAIN` is virtual — items can address it even though
        // no ListMeta row exists for it.
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "milk").unwrap();
        assert_eq!(doc.get_item(&id).unwrap().list_id, LIST_MAIN);
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![id]);
    }

    #[test]
    fn no_document_wide_item_movable_list_remains() {
        // Success criterion for the v2 schema: `items` is a map keyed
        // by item id, ordering lives in per-list order containers, and
        // the old global MovableList root never materializes.
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let other = doc.add_list("Other").unwrap();
        let b = doc.add_item(&other, "b").unwrap();

        assert!(doc.items().get(&a).is_some());
        assert!(doc.items().get(&b).is_some());
        assert_eq!(doc.order_list(LIST_MAIN).len(), 1);
        assert_eq!(doc.order_list(&other).len(), 1);
        // The v1 root (`items` as a MovableList) is a different
        // container type entirely and stays empty.
        assert_eq!(doc.inner.get_movable_list(ROOT_ITEMS).len(), 0);
    }

    #[test]
    fn reordering_one_list_does_not_touch_other_order_containers() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let _b = doc.add_item(LIST_MAIN, "b").unwrap();
        let o1 = doc.add_item(&other, "o1").unwrap();
        let o2 = doc.add_item(&other, "o2").unwrap();

        let other_before: Vec<Option<OrderEntry>> = {
            let order = doc.order_list(&other);
            (0..order.len())
                .map(|i| scalar_entry_at(&order, i))
                .collect()
        };
        let vv_before = doc.oplog_vv();

        doc.move_item(&a, LIST_MAIN, 1).unwrap();

        let other_after: Vec<Option<OrderEntry>> = {
            let order = doc.order_list(&other);
            (0..order.len())
                .map(|i| scalar_entry_at(&order, i))
                .collect()
        };
        assert_eq!(other_before, other_after);
        assert_eq!(doc.live_item_ids(&other), vec![o1, o2]);
        assert!(doc.oplog_vv() != vv_before, "the reorder itself committed");
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
    fn status_flips_do_not_touch_order_containers() {
        // Decision pinned by spec/data-model.md: done/binned are pure
        // item-map writes; the entry stays where it is so restore is
        // exact-position for free.
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let c = doc.add_item(LIST_MAIN, "c").unwrap();
        let order_len_before = doc.order_list(LIST_MAIN).len();

        doc.set_item_done(&b, true).unwrap();
        assert_eq!(doc.order_list(LIST_MAIN).len(), order_len_before);
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a.clone(), c.clone()]);

        doc.set_item_done(&b, false).unwrap();
        assert_eq!(doc.order_list(LIST_MAIN).len(), order_len_before);
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, b, c]);
        assert_live_projection_matches_doc(&doc);
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
    fn hard_delete_removes_order_entries() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        doc.set_item_binned(&b, true).unwrap();
        assert_eq!(doc.order_list(LIST_MAIN).len(), 2);
        doc.delete_binned(&b).unwrap();
        assert_eq!(doc.order_list(LIST_MAIN).len(), 1);
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a]);
        assert_live_projection_matches_doc(&doc);
    }

    #[test]
    fn delete_list_reassigns_items_to_main() {
        let doc = Doc::new().unwrap();
        let mylist = doc.add_list("Errands").unwrap();
        let id = doc.add_item(&mylist, "milk").unwrap();
        doc.delete_list(&mylist).unwrap();
        let view = doc.get_item(&id).unwrap();
        assert_eq!(view.list_id, LIST_MAIN);
    }

    #[test]
    fn delete_list_moves_live_done_and_binned_items_with_fresh_placements() {
        let doc = Doc::new().unwrap();
        let mylist = doc.add_list("Errands").unwrap();
        let live = doc.add_item(&mylist, "live").unwrap();
        let done = doc.add_item(&mylist, "done").unwrap();
        let binned = doc.add_item(&mylist, "binned").unwrap();
        doc.set_item_done(&done, true).unwrap();
        doc.set_item_binned(&binned, true).unwrap();
        let main_existing = doc.add_item(LIST_MAIN, "already here").unwrap();

        doc.delete_list(&mylist).unwrap();

        for id in [&live, &done, &binned] {
            assert_eq!(doc.get_item(id).unwrap().list_id, LIST_MAIN);
        }
        // Live projection: existing main item first, then the deleted
        // list's live item appended.
        assert_eq!(
            doc.live_item_ids(LIST_MAIN),
            vec![main_existing, live.clone()]
        );
        // Done/binned semantics unchanged.
        assert_eq!(doc.done_item_ids(), vec![done]);
        assert_eq!(doc.binned_item_ids(), vec![binned]);
        assert_live_projection_matches_doc(&doc);
    }

    #[test]
    fn delete_main_refused() {
        let doc = Doc::new().unwrap();
        assert!(matches!(
            doc.delete_list(LIST_MAIN).unwrap_err(),
            DocError::CannotDeleteBuiltin(_)
        ));
    }

    #[test]
    fn new_doc_has_show_list_counts_on() {
        let doc = Doc::new().unwrap();
        assert!(doc.get_settings().show_list_counts);
    }

    #[test]
    fn show_list_counts_round_trips() {
        let doc = Doc::new().unwrap();
        // Default is on; the opt-out (`false`) is what gets persisted.
        doc.set_show_list_counts(false).unwrap();
        assert!(!doc.get_settings().show_list_counts);
        let bytes = doc.save().unwrap();
        let restored = Doc::load(&bytes).unwrap();
        assert!(!restored.get_settings().show_list_counts);
        // Toggling back on drops the key — verify the round-trip to the
        // default.
        doc.set_show_list_counts(true).unwrap();
        assert!(doc.get_settings().show_list_counts);
    }

    #[test]
    fn show_list_counts_idempotent() {
        let doc = Doc::new().unwrap();
        let _ = doc.drain_events();
        // On is the default, so setting it on is a no-op.
        doc.set_show_list_counts(true).unwrap();
        assert!(
            doc.drain_events().is_empty(),
            "no-op toggle must not emit events"
        );
        doc.set_show_list_counts(false).unwrap();
        let evs = doc.drain_events();
        assert!(matches!(
            evs.as_slice(),
            [AppEvent::SettingsChanged {
                show_list_counts: false,
                ..
            }]
        ));
        doc.set_show_list_counts(false).unwrap();
        assert!(
            doc.drain_events().is_empty(),
            "second toggle to same value must not re-emit"
        );
    }

    #[test]
    fn main_name_round_trips() {
        let doc = Doc::new().unwrap();
        assert_eq!(doc.get_settings().main_name, None);
        doc.set_main_name("Today").unwrap();
        assert_eq!(doc.get_settings().main_name.as_deref(), Some("Today"));
        // Save/load preserves the override across the on-disk envelope.
        let bytes = doc.save().unwrap();
        let restored = Doc::load(&bytes).unwrap();
        assert_eq!(restored.get_settings().main_name.as_deref(), Some("Today"));
        // Whitespace is trimmed; surrounding spaces collapse, internal
        // spaces survive verbatim.
        doc.set_main_name("  My Day  ").unwrap();
        assert_eq!(doc.get_settings().main_name.as_deref(), Some("My Day"));
        // Empty input clears the override entirely — clients fall back
        // to the localized built-in label.
        doc.set_main_name("").unwrap();
        assert_eq!(doc.get_settings().main_name, None);
        doc.set_main_name("  ").unwrap();
        assert_eq!(doc.get_settings().main_name, None);
    }

    #[test]
    fn main_name_idempotent() {
        let doc = Doc::new().unwrap();
        let _ = doc.drain_events();
        // Setting empty when already empty is a no-op.
        doc.set_main_name("").unwrap();
        assert!(doc.drain_events().is_empty());
        doc.set_main_name("Today").unwrap();
        let evs = doc.drain_events();
        assert!(matches!(
            evs.as_slice(),
            [AppEvent::SettingsChanged {
                main_name: Some(_),
                ..
            }]
        ));
        // Setting the same value (after trim) is also a no-op.
        doc.set_main_name("  Today  ").unwrap();
        assert!(doc.drain_events().is_empty());
    }

    #[test]
    fn save_load_round_trip_preserves_state() {
        let doc = Doc::new().unwrap();
        let id = doc.add_item(LIST_MAIN, "persisted").unwrap();
        let bytes = doc.save().unwrap();
        let restored = Doc::load(&bytes).unwrap();
        assert_eq!(restored.get_item(&id).unwrap().text, "persisted");
        assert_eq!(restored.fingerprint(), doc.fingerprint());
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
        assert_live_projection_matches_doc(&a);
        assert_live_projection_matches_doc(&b);
    }

    #[test]
    fn fingerprint_diverges_when_state_diverges() {
        let mut a = Doc::new().unwrap();
        let mut b = Doc::new().unwrap();
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
    fn repeated_moves_keep_index_in_sync() {
        let doc = Doc::new().unwrap();
        let _a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let _c = doc.add_item(LIST_MAIN, "c").unwrap();

        for target in [0, 2, 0, 2, 1, 0, 2, 0, 1, 2] {
            doc.move_item(&b, LIST_MAIN, target).unwrap();
            assert_eq!(
                doc.live_item_ids(LIST_MAIN).iter().position(|id| id == &b),
                Some(target)
            );
            assert_live_projection_matches_doc(&doc);
        }
    }

    #[test]
    fn cross_list_move_preserves_identity_and_content() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let id = doc.add_item(LIST_MAIN, "wandering").unwrap();
        doc.edit_item_notes(&id, "some notes").unwrap();
        let before = doc.get_item(&id).unwrap();

        doc.move_item(&id, &other, 0).unwrap();
        let after = doc.get_item(&id).unwrap();

        assert_eq!(after.id, before.id);
        assert_eq!(after.text, before.text);
        assert_eq!(after.notes, before.notes);
        assert_eq!(after.created_at, before.created_at);
        assert_eq!(after.list_id, other);
        assert_eq!(doc.live_item_ids(&other), vec![id]);
        assert!(doc.live_item_ids(LIST_MAIN).is_empty());
        assert_live_projection_matches_doc(&doc);
    }

    #[test]
    fn cross_list_move_removes_source_entry_best_effort() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let id = doc.add_item(LIST_MAIN, "x").unwrap();
        assert_eq!(doc.order_list(LIST_MAIN).len(), 1);
        doc.move_item(&id, &other, 0).unwrap();
        assert_eq!(
            doc.order_list(LIST_MAIN).len(),
            0,
            "source order entry cleaned up"
        );
        assert_eq!(doc.order_list(&other).len(), 1);
    }

    #[test]
    fn live_projection_survives_bulk_archive_then_reorder() {
        let doc = Doc::new().unwrap();
        let historical = doc
            .add_items_at(LIST_MAIN, &["old 1", "old 2", "old 3"], 0)
            .unwrap();
        let historical_refs: Vec<&str> = historical.iter().map(String::as_str).collect();
        doc.set_items_done(&historical_refs, true).unwrap();

        let live = doc
            .add_items_at(LIST_MAIN, &["current 1", "current 2", "current 3"], 0)
            .unwrap();
        doc.move_item(&live[2], LIST_MAIN, 0).unwrap();

        assert_eq!(
            doc.live_item_ids(LIST_MAIN),
            vec![live[2].clone(), live[0].clone(), live[1].clone()]
        );
        assert_live_projection_matches_doc(&doc);
    }

    #[test]
    fn view_helpers_empty_doc() {
        let doc = Doc::new().unwrap();
        assert_eq!(doc.live_item_ids(LIST_MAIN), Vec::<String>::new());
        assert_eq!(doc.done_item_ids(), Vec::<String>::new());
        assert_eq!(doc.binned_item_ids(), Vec::<String>::new());
    }

    #[test]
    fn live_item_ids_match_order_container() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let c = doc.add_item(LIST_MAIN, "c").unwrap();
        // Items in another list must not leak into main's view.
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
    fn deleted_list_orphans_appear_under_main() {
        let doc = Doc::new().unwrap();
        let mylist = doc.add_list("Errands").unwrap();
        let id = doc.add_item(&mylist, "x").unwrap();
        doc.delete_list(&mylist).unwrap();
        assert!(doc.live_item_ids(&mylist).is_empty());
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![id]);
    }

    #[test]
    fn json_export_includes_builtin_and_user_lists() {
        let doc = Doc::new().unwrap();
        let errands = doc.add_list("Errands").unwrap();
        doc.set_show_list_counts(true).unwrap();

        let export = doc.export_json();

        assert_eq!(export.version, 1);
        assert!(export.settings.show_list_counts);
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
        // Main has no ListMeta row, so no metadata in the doc —
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

    // ---------- stale / duplicate / missing order entries ----------

    /// Concurrent cross-list moves of the same item: both replicas
    /// insert an entry into a different order container; the item's
    /// atomic location register picks one winner and the loser's entry
    /// goes stale. Exactly one visible item, on both replicas.
    #[test]
    fn concurrent_cross_list_moves_converge_to_one_visible_item() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let list_x = a.add_list("X").unwrap();
        let list_y = a.add_list("Y").unwrap();
        let id = a.add_item(LIST_MAIN, "contested").unwrap();
        let seed = a.pending_export(&dek).unwrap().unwrap();
        a.mark_pushed();
        let mut b = Doc::empty();
        b.apply_remote(&dek, &seed).unwrap();

        // Concurrent: A moves it to X, B moves it to Y.
        a.move_item(&id, &list_x, 0).unwrap();
        b.move_item(&id, &list_y, 0).unwrap();
        let blob_a = a.pending_export(&dek).unwrap().unwrap();
        a.mark_pushed();
        let blob_b = b.pending_export(&dek).unwrap().unwrap();
        b.mark_pushed();
        a.apply_remote(&dek, &blob_b).unwrap();
        b.apply_remote(&dek, &blob_a).unwrap();

        assert_eq!(a.fingerprint(), b.fingerprint());
        let winner = a.get_item(&id).unwrap().list_id;
        assert!(winner == list_x || winner == list_y);
        let visible_in = |d: &Doc| {
            [LIST_MAIN, list_x.as_str(), list_y.as_str()]
                .iter()
                .filter(|l| d.live_item_ids(l).contains(&id))
                .count()
        };
        assert_eq!(visible_in(&a), 1, "exactly one visible copy on A");
        assert_eq!(visible_in(&b), 1, "exactly one visible copy on B");
        assert_live_projection_matches_doc(&a);
        assert_live_projection_matches_doc(&b);
    }

    /// Concurrent reorder on one replica and status change on another
    /// must merge cleanly: the order mov and the status flip touch
    /// disjoint containers.
    #[test]
    fn concurrent_reorder_and_status_change_converge() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let ids: Vec<String> = ["a", "b", "c", "d"]
            .iter()
            .map(|t| a.add_item(LIST_MAIN, t).unwrap())
            .collect();
        let seed = a.pending_export(&dek).unwrap().unwrap();
        a.mark_pushed();
        let mut b = Doc::empty();
        b.apply_remote(&dek, &seed).unwrap();

        a.move_item(&ids[3], LIST_MAIN, 0).unwrap();
        b.set_item_done(&ids[1], true).unwrap();
        let blob_a = a.pending_export(&dek).unwrap().unwrap();
        a.mark_pushed();
        let blob_b = b.pending_export(&dek).unwrap().unwrap();
        b.mark_pushed();
        a.apply_remote(&dek, &blob_b).unwrap();
        b.apply_remote(&dek, &blob_a).unwrap();

        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_eq!(
            a.live_item_ids(LIST_MAIN),
            vec![ids[3].clone(), ids[0].clone(), ids[2].clone()]
        );
        assert!(a.get_item(&ids[1]).unwrap().is_done());
        assert_live_projection_matches_doc(&a);
        assert_live_projection_matches_doc(&b);
    }

    /// A hand-crafted stale entry (placement mismatch) must never make
    /// the item visible, and a duplicate entry must not double it.
    #[test]
    fn stale_and_duplicate_entries_are_invisible() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();

        // Duplicate of a's canonical entry + a stale entry with a bogus
        // placement + an entry for a nonexistent item.
        let a_placement = {
            let guard = doc.item_index.lock().unwrap();
            guard.meta[&a].placement_id.clone()
        };
        let order = doc.order_list(LIST_MAIN);
        order
            .push(
                OrderEntry {
                    item_id: a.clone(),
                    placement_id: a_placement,
                }
                .encode()
                .as_str(),
            )
            .unwrap();
        order
            .push(
                OrderEntry {
                    item_id: b.clone(),
                    placement_id: "bogus".to_string(),
                }
                .encode()
                .as_str(),
            )
            .unwrap();
        order.push("no-such-item:whatever").unwrap();
        doc.inner.commit();
        doc.rebuild_index();

        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, b]);
        assert_eq!(doc.order_list(LIST_MAIN).len(), 5);
        assert_live_projection_matches_doc(&doc);
    }

    /// An item whose canonical entry is missing entirely still projects
    /// — appended deterministically after entry-backed items — and
    /// `reconcile` materializes a real entry without changing the
    /// visible order.
    #[test]
    fn missing_entry_falls_back_deterministically_and_reconciles() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let c = doc.add_item(LIST_MAIN, "c").unwrap();

        // Simulate a lost entry: delete b's canonical entry directly.
        let b_pos = {
            let guard = doc.item_index.lock().unwrap();
            guard.canonical_raw_pos(LIST_MAIN, &b).unwrap()
        };
        doc.order_list(LIST_MAIN).delete(b_pos, 1).unwrap();
        doc.inner.commit();
        doc.rebuild_index();

        // b is not hidden: it lands in the fallback tail (after the
        // entry-backed items, created_at/id order).
        assert_eq!(
            doc.live_item_ids(LIST_MAIN),
            vec![a.clone(), c.clone(), b.clone()]
        );

        // Reads must not have mutated anything.
        assert_eq!(doc.order_list(LIST_MAIN).len(), 2);

        // Reconcile materializes b's entry; visible order unchanged.
        let repairs = doc.reconcile().unwrap();
        assert!(repairs >= 1, "expected at least one repair");
        assert_eq!(doc.order_list(LIST_MAIN).len(), 3);
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, c, b]);
        assert_live_projection_matches_doc(&doc);
        // Second run is a no-op.
        assert_eq!(doc.reconcile().unwrap(), 0);
    }

    #[test]
    fn reconcile_removes_stale_and_duplicate_entries() {
        let doc = Doc::new().unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let a_placement = {
            let guard = doc.item_index.lock().unwrap();
            guard.meta[&a].placement_id.clone()
        };
        let order = doc.order_list(LIST_MAIN);
        order
            .push(
                OrderEntry {
                    item_id: a.clone(),
                    placement_id: a_placement,
                }
                .encode()
                .as_str(),
            )
            .unwrap();
        order.push("ghost:stale").unwrap();
        doc.inner.commit();
        doc.rebuild_index();
        assert_eq!(doc.order_list(LIST_MAIN).len(), 3);

        let repairs = doc.reconcile().unwrap();
        assert_eq!(repairs, 2);
        assert_eq!(doc.order_list(LIST_MAIN).len(), 1);
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a]);
        assert_eq!(doc.reconcile().unwrap(), 0);
        assert_live_projection_matches_doc(&doc);
    }

    // ---------- AppEvent tests ----------

    #[test]
    fn local_add_item_emits_item_added() {
        let doc = Doc::new().unwrap();
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
                live_index,
                ..
            } => {
                assert_eq!(eid, &id);
                assert_eq!(list_id, LIST_MAIN);
                assert_eq!(text, "milk");
                assert!(done_at.is_none());
                assert!(binned_at.is_none());
                assert_eq!(*live_index, Some(0));
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
            [
                AppEvent::ItemStatusChanged {
                    id: eid,
                    done_at,
                    binned_at,
                    live_index,
                },
            ] => {
                assert_eq!(eid, &id);
                assert!(done_at.is_some());
                assert!(binned_at.is_none());
                assert_eq!(*live_index, None, "done item leaves the live projection");
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
            [
                AppEvent::ItemStatusChanged {
                    id: eid,
                    done_at,
                    binned_at,
                    live_index,
                },
            ] => {
                assert_eq!(eid, &id);
                assert!(done_at.is_some(), "done state must be preserved");
                assert!(binned_at.is_some());
                assert_eq!(*live_index, None);
            }
            other => panic!("unexpected events: {other:?}"),
        }
    }

    #[test]
    fn local_cross_list_move_emits_list_changed_with_live_index() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let anchor = doc.add_item(&other, "anchor").unwrap();
        let moved = doc.add_item(LIST_MAIN, "moved").unwrap();
        let _ = doc.drain_events();

        doc.move_item(&moved, &other, 1).unwrap();

        let evs = doc.drain_events();
        match evs.as_slice() {
            [
                AppEvent::ItemListChanged {
                    id,
                    list_id,
                    live_index,
                },
            ] => {
                assert_eq!(id, &moved);
                assert_eq!(list_id, &other);
                assert_eq!(*live_index, Some(1));
            }
            other_evs => panic!("expected one ItemListChanged, got {other_evs:?}"),
        }
        assert_eq!(doc.live_item_ids(&other), vec![anchor, moved]);
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
                AppEvent::ItemListChanged {
                    id: eid,
                    list_id,
                    live_index,
                } => {
                    assert_eq!(eid, &id);
                    assert_eq!(list_id, LIST_MAIN);
                    assert_eq!(
                        *live_index,
                        Some(0),
                        "live orphan lands in main's live projection"
                    );
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

    /// Seed a peer doc `b` with `a`'s current state, mark `a` pushed,
    /// and drain both event queues so the next frame's events are the
    /// only thing under test.
    fn sync_fresh_peer(a: &mut Doc, dek: &Dek) -> Doc {
        let blob = a.pending_export(dek).unwrap().expect("seed blob");
        a.mark_pushed();
        let mut b = Doc::empty();
        b.apply_remote(dek, &blob).unwrap();
        let _ = a.drain_events();
        let _ = b.drain_events();
        b
    }

    #[test]
    fn remote_status_change_translates_to_one_surgical_event() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let first = a.add_item(LIST_MAIN, "first").unwrap();
        let _second = a.add_item(LIST_MAIN, "second").unwrap();
        let mut b = sync_fresh_peer(&mut a, &dek);

        a.set_item_done(&first, true).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        // Exactly one precise event — a fallback resync would instead
        // emit a FullResync control signal.
        let evs = b.drain_events();
        match evs.as_slice() {
            [
                AppEvent::ItemStatusChanged {
                    id,
                    done_at,
                    binned_at,
                    live_index,
                },
            ] => {
                assert_eq!(id, &first);
                assert!(done_at.is_some());
                assert!(binned_at.is_none());
                assert_eq!(*live_index, None);
            }
            other => panic!("expected surgical ItemStatusChanged, got {other:?}"),
        }
        assert_live_projection_matches_doc(&b);
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn remote_move_translates_to_item_moved_with_live_index() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let _first = a.add_item(LIST_MAIN, "first").unwrap();
        let _second = a.add_item(LIST_MAIN, "second").unwrap();
        let third = a.add_item(LIST_MAIN, "third").unwrap();
        let mut b = sync_fresh_peer(&mut a, &dek);

        a.move_item(&third, LIST_MAIN, 0).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        let evs = b.drain_events();
        match evs.as_slice() {
            [AppEvent::ItemMoved { id, live_index }] => {
                assert_eq!(id, &third);
                assert_eq!(*live_index, Some(0));
            }
            other => panic!("expected surgical ItemMoved, got {other:?}"),
        }
        assert_live_projection_matches_doc(&b);
        assert_eq!(b.live_item_ids(LIST_MAIN)[0], third);
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    /// Replay a frame's emitted events the way the JS store does:
    /// naive per-list arrays, remove-then-insert at `live_index`,
    /// applied in emission order. This is the contract the translator
    /// must satisfy — the Rust-internal projection and Loro fingerprint
    /// can be correct while the *emitted events* fail to converge on
    /// the consumer.
    fn replay_live_events(
        pre: &HashMap<String, Vec<String>>,
        evs: &[AppEvent],
    ) -> HashMap<String, Vec<String>> {
        let mut live = pre.clone();
        let remove_everywhere = |live: &mut HashMap<String, Vec<String>>, id: &str| {
            for arr in live.values_mut() {
                arr.retain(|x| x != id);
            }
        };
        let insert_at =
            |live: &mut HashMap<String, Vec<String>>, list: &str, id: &str, at: usize| {
                let arr = live.entry(list.to_string()).or_default();
                arr.insert(at.min(arr.len()), id.to_string());
            };
        for ev in evs {
            match ev {
                AppEvent::ItemAdded {
                    id,
                    list_id,
                    live_index,
                    ..
                } => {
                    remove_everywhere(&mut live, id);
                    if let Some(li) = live_index {
                        insert_at(&mut live, list_id, id, *li);
                    }
                }
                AppEvent::ItemMoved { id, live_index } => {
                    if let Some(li) = live_index {
                        // The store knows the item's list; the test
                        // replayer finds it by membership.
                        let list = live
                            .iter()
                            .find(|(_, arr)| arr.iter().any(|x| x == id))
                            .map(|(l, _)| l.clone());
                        if let Some(list) = list {
                            remove_everywhere(&mut live, id);
                            insert_at(&mut live, &list, id, *li);
                        }
                    }
                }
                AppEvent::ItemListChanged {
                    id,
                    list_id,
                    live_index,
                } => {
                    // Store semantics: a live item moves lists — remove
                    // from the old array and insert into the new one at
                    // `live_index`, *appending* when absent. A hidden
                    // item only changes its list field.
                    let was_live = live.values().any(|arr| arr.iter().any(|x| x == id));
                    remove_everywhere(&mut live, id);
                    if was_live {
                        let at = live_index.unwrap_or(usize::MAX);
                        insert_at(&mut live, list_id, id, at);
                    }
                }
                AppEvent::ItemStatusChanged { id, live_index, .. } => {
                    // A status event either hides the item (None) or
                    // re-inserts it at its list position. The replayer
                    // needs the list; the store reads it off its item
                    // mirror, the test gets it from the final doc — so
                    // status re-entries are handled by the caller
                    // passing docs whose lists are stable. For pure
                    // reorder/move tests this arm only hides.
                    if live_index.is_none() {
                        remove_everywhere(&mut live, id);
                    }
                }
                AppEvent::ItemRemoved { id } => remove_everywhere(&mut live, id),
                _ => {}
            }
        }
        live.retain(|_, arr| !arr.is_empty());
        live
    }

    fn live_state(doc: &Doc) -> HashMap<String, Vec<String>> {
        let guard = doc.item_index.lock().unwrap();
        guard.live_by_list.clone()
    }

    #[test]
    fn remote_multi_item_move_down_converges_on_consumer() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let ids: Vec<String> = ["a", "b", "c", "d", "e"]
            .iter()
            .map(|t| a.add_item(LIST_MAIN, t).unwrap())
            .collect();
        let mut b = sync_fresh_peer(&mut a, &dek);

        // Select the top two (a, b) and drag them below d — the exact op
        // sequence `planReorderMoves` emits for a two-item downward move:
        // move b to live index 3, then a to live index 2. Final order:
        // [c, d, a, b, e].
        let pre_live = live_state(&b);
        a.move_item(&ids[1], LIST_MAIN, 3).unwrap();
        a.move_item(&ids[0], LIST_MAIN, 2).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        let evs = b.drain_events();
        let expected = vec![
            ids[2].clone(),
            ids[3].clone(),
            ids[0].clone(),
            ids[1].clone(),
            ids[4].clone(),
        ];
        assert_eq!(a.live_item_ids(LIST_MAIN), expected);
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_live_projection_matches_doc(&b);
        assert!(
            !evs.contains(&AppEvent::FullResync),
            "expected surgical events, got a resync: {evs:?}"
        );
        assert_eq!(
            replay_live_events(&pre_live, &evs)
                .get(LIST_MAIN)
                .cloned()
                .unwrap_or_default(),
            expected,
            "emitted events interleave on the consumer; got {evs:?}"
        );
    }

    #[test]
    fn remote_multi_item_move_up_converges_on_consumer() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let ids: Vec<String> = ["a", "b", "c", "d", "e"]
            .iter()
            .map(|t| a.add_item(LIST_MAIN, t).unwrap())
            .collect();
        let mut b = sync_fresh_peer(&mut a, &dek);

        // Select c, d and drag them to the top — `planReorderMoves`
        // emits move c to 0, then d to 1. Final order: [c, d, a, b, e].
        let pre_live = live_state(&b);
        a.move_item(&ids[2], LIST_MAIN, 0).unwrap();
        a.move_item(&ids[3], LIST_MAIN, 1).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        let evs = b.drain_events();
        let expected = vec![
            ids[2].clone(),
            ids[3].clone(),
            ids[0].clone(),
            ids[1].clone(),
            ids[4].clone(),
        ];
        assert_eq!(a.live_item_ids(LIST_MAIN), expected);
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_live_projection_matches_doc(&b);
        assert!(
            !evs.contains(&AppEvent::FullResync),
            "expected surgical events, got a resync: {evs:?}"
        );
        assert_eq!(
            replay_live_events(&pre_live, &evs)
                .get(LIST_MAIN)
                .cloned()
                .unwrap_or_default(),
            expected,
            "emitted events interleave on the consumer; got {evs:?}"
        );
    }

    #[test]
    fn remote_discontiguous_multi_move_converges_on_consumer() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let ids: Vec<String> = ["a", "b", "c", "d", "e", "f"]
            .iter()
            .map(|t| a.add_item(LIST_MAIN, t).unwrap())
            .collect();
        let mut b = sync_fresh_peer(&mut a, &dek);

        // Discontiguous selection {a, c} dragged down to sit before f:
        // move a below e, then c below e. Exercises a non-adjacent widen.
        let pre_live = live_state(&b);
        a.move_item(&ids[0], LIST_MAIN, 3).unwrap();
        a.move_item(&ids[2], LIST_MAIN, 4).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        let evs = b.drain_events();
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_live_projection_matches_doc(&b);
        assert!(
            !evs.contains(&AppEvent::FullResync),
            "expected surgical events, got a resync: {evs:?}"
        );
        assert_eq!(
            replay_live_events(&pre_live, &evs)
                .get(LIST_MAIN)
                .cloned()
                .unwrap_or_default(),
            a.live_item_ids(LIST_MAIN),
            "emitted events interleave on the consumer; got {evs:?}"
        );
    }

    /// Two items changing lists in one frame is surgical in the v2
    /// schema (cross-list moves are ordinary register writes + entry
    /// ops), where v1 had to fall back to a whole-doc resync.
    #[test]
    fn remote_cross_list_multi_move_is_surgical_and_converges() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let other = a.add_list("Other").unwrap();
        let m0 = a.add_item(LIST_MAIN, "m0").unwrap();
        let m1 = a.add_item(LIST_MAIN, "m1").unwrap();
        let _o0 = a.add_item(&other, "o0").unwrap();
        let _o1 = a.add_item(&other, "o1").unwrap();
        let mut b = sync_fresh_peer(&mut a, &dek);

        let pre_live = live_state(&b);
        a.move_item(&m0, &other, 1).unwrap();
        a.move_item(&m1, &other, 2).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        let evs = b.drain_events();
        assert!(
            !evs.contains(&AppEvent::FullResync),
            "expected surgical events, got a resync: {evs:?}"
        );
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_live_projection_matches_doc(&b);
        assert_eq!(a.live_item_ids(&other), b.live_item_ids(&other));
        assert_eq!(a.live_item_ids(LIST_MAIN), b.live_item_ids(LIST_MAIN));
        let replayed = replay_live_events(&pre_live, &evs);
        assert_eq!(
            replayed.get(other.as_str()).cloned().unwrap_or_default(),
            b.live_item_ids(&other)
        );
        assert_eq!(
            replayed.get(LIST_MAIN).cloned().unwrap_or_default(),
            b.live_item_ids(LIST_MAIN)
        );
    }

    #[test]
    fn remote_delete_translates_to_item_removed() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let victim = a.add_item(LIST_MAIN, "victim").unwrap();
        let _keeper = a.add_item(LIST_MAIN, "keeper").unwrap();
        a.set_item_binned(&victim, true).unwrap();
        let mut b = sync_fresh_peer(&mut a, &dek);

        a.delete_binned(&victim).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        let evs = b.drain_events();
        assert!(
            matches!(evs.as_slice(), [AppEvent::ItemRemoved { id }] if id == &victim),
            "expected surgical ItemRemoved, got {evs:?}"
        );
        assert_live_projection_matches_doc(&b);
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn remote_cross_list_move_translates_to_list_changed() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let other = a.add_list("Other").unwrap();
        let roamer = a.add_item(LIST_MAIN, "roamer").unwrap();
        let _anchor1 = a.add_item(&other, "anchor1").unwrap();
        let _anchor2 = a.add_item(&other, "anchor2").unwrap();
        let mut b = sync_fresh_peer(&mut a, &dek);

        a.move_item(&roamer, &other, 1).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        let evs = b.drain_events();
        // Leave-signal first (consumer moves the item to the target
        // list, appended), then the positional correction.
        match evs.as_slice() {
            [
                AppEvent::ItemListChanged {
                    id: lid,
                    list_id,
                    live_index: li1,
                },
                AppEvent::ItemMoved {
                    id: mid,
                    live_index: li2,
                },
            ] => {
                assert_eq!(lid, &roamer);
                assert_eq!(mid, &roamer);
                assert_eq!(list_id, &other);
                assert_eq!(*li1, None, "leave-signal carries no position");
                assert_eq!(*li2, Some(1));
            }
            other_evs => panic!("expected ItemListChanged + ItemMoved, got {other_evs:?}"),
        }
        assert_live_projection_matches_doc(&b);
        assert_eq!(b.live_item_ids(&other)[1], roamer);
        assert_eq!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn remote_bulk_frame_falls_back_and_converges() {
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        let texts: Vec<String> = (0..100).map(|i| format!("bulk {i}")).collect();
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        let ids = a.add_items_at(LIST_MAIN, &refs, 0).unwrap();
        let mut b = sync_fresh_peer(&mut a, &dek);

        // 100 dirty items in one frame → over DIFF_TRANSLATE_MAX_DIRTY.
        let id_refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        a.set_items_done(&id_refs, true).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();
        b.apply_remote(&dek, &blob).unwrap();

        let evs = b.drain_events();
        assert_eq!(evs, vec![AppEvent::FullResync]);
        assert_live_projection_matches_doc(&b);
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert!(b.live_item_ids(LIST_MAIN).is_empty());
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
        // ListMeta row, so no ListAdded is emitted for it.
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
    fn snapshot_then_multiple_trailing_deltas_converge_on_fresh_peer() {
        // Mirrors the e2e bootstrap: a producer captures N ops one at a
        // time (pending_export + mark_pushed, the capture-cursor model),
        // a full snapshot is taken mid-stream, then more ops are
        // captured. A fresh peer applies the snapshot followed by the
        // trailing per-op deltas as a batch and must converge.
        let dek = Dek::generate();
        let mut a = Doc::new().unwrap();
        a.mark_pushed(); // cursor at the seed, like Doc.create() on web

        // Five captured ops, one delta each.
        for i in 0..5 {
            a.add_item(LIST_MAIN, &format!("item {i}")).unwrap();
            let _ = a.pending_export(&dek).unwrap().unwrap();
            a.mark_pushed();
        }
        // Snapshot taken here (frontier = 5 items).
        let snapshot = a.snapshot_blob(&dek).unwrap();

        // Three more captured ops, one delta each.
        let mut trailing = Vec::new();
        for i in 5..8 {
            a.add_item(LIST_MAIN, &format!("item {i}")).unwrap();
            trailing.push(a.pending_export(&dek).unwrap().unwrap());
            a.mark_pushed();
        }

        // Fresh peer: snapshot, then the trailing deltas as a batch.
        let mut b = Doc::empty();
        b.apply_remote(&dek, &snapshot).unwrap();
        b.apply_remote_batch(&dek, trailing.iter()).unwrap();

        assert_eq!(b.fingerprint(), a.fingerprint());
        let texts: Vec<String> = b
            .items_in_list(LIST_MAIN, false)
            .into_iter()
            .map(|it| it.text)
            .collect();
        assert_eq!(
            texts.len(),
            8,
            "expected all 8 items on the peer, got {texts:?}"
        );
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
    fn add_item_at_emits_item_added_with_live_index() {
        let doc = Doc::new().unwrap();
        let _a = doc.add_item(LIST_MAIN, "a").unwrap();
        let _b = doc.add_item(LIST_MAIN, "b").unwrap();
        let _ = doc.drain_events();
        let mid = doc.add_item_at(LIST_MAIN, "mid", 1).unwrap();
        let evs = doc.drain_events();
        assert_eq!(evs.len(), 1);
        match &evs[0] {
            AppEvent::ItemAdded { id, live_index, .. } => {
                assert_eq!(id, &mid);
                assert_eq!(*live_index, Some(1));
            }
            other => panic!("expected ItemAdded, got {other:?}"),
        }
    }

    #[test]
    fn local_move_item_emits_destination_live_index() {
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
                |e| matches!(e, AppEvent::ItemMoved { id, live_index } if id == &moved && *live_index == Some(0))
            ),
            "expected ItemMoved to live index 0, got {evs:?}"
        );
    }

    #[test]
    fn set_items_binned_small_batch_is_surgical_and_restores_position() {
        let doc = Doc::new().unwrap();
        let first = doc.add_item(LIST_MAIN, "first").unwrap();
        let second = doc.add_item(LIST_MAIN, "second").unwrap();
        let third = doc.add_item(LIST_MAIN, "third").unwrap();
        let _ = doc.drain_events();

        // Below the bulk threshold: exactly one per-item event, no
        // whole-doc diff artifacts (which would add ItemMoved noise).
        doc.set_items_binned(&[second.as_str()], true).unwrap();
        let evs = doc.drain_events();
        match evs.as_slice() {
            [
                AppEvent::ItemStatusChanged {
                    id,
                    binned_at,
                    live_index,
                    ..
                },
            ] => {
                assert_eq!(id, &second);
                assert!(binned_at.is_some());
                assert_eq!(*live_index, None);
            }
            other => panic!("expected one surgical ItemStatusChanged, got {other:?}"),
        }
        assert_live_projection_matches_doc(&doc);
        assert_eq!(
            doc.live_item_ids(LIST_MAIN),
            vec![first.clone(), third.clone()]
        );

        // Restore: re-enters the live projection at its former position
        // (between first and third — the entry never moved), and the
        // event says so.
        doc.set_items_binned(&[second.as_str()], false).unwrap();
        let evs = doc.drain_events();
        match evs.as_slice() {
            [
                AppEvent::ItemStatusChanged {
                    id,
                    binned_at,
                    live_index,
                    ..
                },
            ] => {
                assert_eq!(id, &second);
                assert!(binned_at.is_none());
                assert_eq!(*live_index, Some(1));
            }
            other => panic!("expected one surgical ItemStatusChanged, got {other:?}"),
        }
        assert_live_projection_matches_doc(&doc);
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![first, second, third]);
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
    fn add_items_at_emits_one_event_per_item_with_increasing_live_indices() {
        let doc = Doc::new().unwrap();
        let _a = doc.add_item(LIST_MAIN, "a").unwrap();
        let _b = doc.add_item(LIST_MAIN, "b").unwrap();
        let _ = doc.drain_events();
        let ids = doc.add_items_at(LIST_MAIN, &["x", "y"], 1).unwrap();
        let evs = doc.drain_events();
        let added: Vec<(String, Option<usize>)> = evs
            .iter()
            .filter_map(|e| match e {
                AppEvent::ItemAdded { id, live_index, .. } => Some((id.clone(), *live_index)),
                _ => None,
            })
            .collect();
        assert_eq!(added.len(), 2);
        assert_eq!(added[0], (ids[0].clone(), Some(1)));
        assert_eq!(added[1], (ids[1].clone(), Some(2)));
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
        doc.set_show_list_counts(true).unwrap();
        let _ = doc.drain_events();

        let snap = doc.snapshot_events();
        assert!(snap.iter().any(|e| matches!(
            e,
            AppEvent::SettingsChanged {
                show_list_counts: true,
                ..
            }
        )));
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
    fn import_json_creates_lists_with_fresh_ids_and_routes_main_locally() {
        let src = Doc::new().unwrap();
        let other = src.add_list("Other").unwrap();
        let _ = src.add_item(LIST_MAIN, "in-main").unwrap();
        let _ = src.add_item(&other, "in-other").unwrap();
        let export = src.export_json();

        let dst = Doc::new().unwrap();
        let summary = dst.import_json(&export).unwrap();

        assert_eq!(summary.lists_added, 1);
        assert_eq!(summary.items_added, 2);
        assert_eq!(summary.items_skipped, 0);

        let dst_lists = dst.all_lists();
        assert_eq!(dst_lists.len(), 1);
        assert_eq!(dst_lists[0].name, "Other");
        // New list got a fresh id — additive means we do *not* reuse the
        // source's list id.
        assert_ne!(dst_lists[0].id, other);

        let texts_main: Vec<String> = dst
            .iter_items()
            .filter(|i| i.list_id == LIST_MAIN)
            .map(|i| i.text)
            .collect();
        assert_eq!(texts_main, vec!["in-main"]);

        let texts_other: Vec<String> = dst
            .iter_items()
            .filter(|i| i.list_id == dst_lists[0].id)
            .map(|i| i.text)
            .collect();
        assert_eq!(texts_other, vec!["in-other"]);
    }

    #[test]
    fn import_json_preserves_timestamps_done_binned_and_notes() {
        let src = Doc::new().unwrap();
        let a = src.add_item(LIST_MAIN, "alpha").unwrap();
        let b = src.add_item(LIST_MAIN, "beta").unwrap();
        let c = src.add_item(LIST_MAIN, "gamma").unwrap();
        src.edit_item_notes(&a, "alpha notes").unwrap();
        src.set_item_done(&b, true).unwrap();
        src.set_item_binned(&c, true).unwrap();

        let src_view_a = src.get_item(&a).unwrap();
        let src_view_b = src.get_item(&b).unwrap();
        let src_view_c = src.get_item(&c).unwrap();
        let export = src.export_json();

        let dst = Doc::new().unwrap();
        dst.import_json(&export).unwrap();

        let imported: Vec<ItemView> = dst.iter_items().collect();
        let by_text = |t: &str| imported.iter().find(|i| i.text == t).unwrap();
        let ia = by_text("alpha");
        let ib = by_text("beta");
        let ic = by_text("gamma");

        assert_eq!(ia.notes, "alpha notes");
        assert_eq!(ia.created_at, src_view_a.created_at);

        assert_eq!(ib.done_at, src_view_b.done_at);
        assert!(ib.done_at.is_some());

        assert_eq!(ic.binned_at, src_view_c.binned_at);
        assert!(ic.binned_at.is_some());
    }

    #[test]
    fn import_json_preserves_per_list_order() {
        let src = Doc::new().unwrap();
        let l = src.add_list("Ordered").unwrap();
        let x = src.add_item(&l, "x").unwrap();
        let _y = src.add_item(&l, "y").unwrap();
        let _z = src.add_item(&l, "z").unwrap();
        // Reorder so array order != creation order.
        src.move_item(&x, &l, 2).unwrap();
        let src_texts: Vec<String> = src
            .items_in_list(&l, true)
            .into_iter()
            .map(|i| i.text)
            .collect();
        assert_eq!(src_texts, vec!["y", "z", "x"]);

        let dst = Doc::new().unwrap();
        dst.import_json(&src.export_json()).unwrap();
        let dst_list = dst.all_lists()[0].id.clone();
        let dst_texts: Vec<String> = dst
            .items_in_list(&dst_list, true)
            .into_iter()
            .map(|i| i.text)
            .collect();
        assert_eq!(dst_texts, src_texts, "array order carries the ordering");
    }

    #[test]
    fn import_json_is_additive_existing_content_untouched() {
        let dst = Doc::new().unwrap();
        let local_list = dst.add_list("LocalKeep").unwrap();
        let local_item = dst.add_item(LIST_MAIN, "local-main").unwrap();
        let _ = dst.add_item(&local_list, "local-other").unwrap();

        let src = Doc::new().unwrap();
        let _ = src.add_list("Imported").unwrap();
        let _ = src.add_item(LIST_MAIN, "src-main").unwrap();
        let export = src.export_json();

        dst.import_json(&export).unwrap();

        // Pre-existing list and item still present, untouched.
        assert!(dst.get_item(&local_item).is_some());
        let names: Vec<String> = dst.all_lists().into_iter().map(|l| l.name).collect();
        assert!(names.contains(&"LocalKeep".to_string()));
        assert!(names.contains(&"Imported".to_string()));
        assert_eq!(names.len(), 2);

        // Both `src-main` and `local-main` live in main.
        let main_texts: Vec<String> = dst
            .iter_items()
            .filter(|i| i.list_id == LIST_MAIN)
            .map(|i| i.text)
            .collect();
        assert!(main_texts.contains(&"local-main".to_string()));
        assert!(main_texts.contains(&"src-main".to_string()));
    }

    #[test]
    fn import_json_orphan_items_fall_back_to_main() {
        // Hand-crafted export with an item pointing at a list_id that
        // isn't in `lists` — same orphan handling as a deleted source
        // list. Should land in main, not silently dropped.
        let export = JsonExport {
            version: 1,
            settings: ExportSettings {
                show_list_counts: false,
                main_name: None,
            },
            lists: vec![ExportList {
                id: LIST_MAIN.to_string(),
                name: LIST_MAIN_NAME.to_string(),
                created_at: None,
                builtin: true,
            }],
            items: vec![ExportItem {
                id: "orphan-id".to_string(),
                text: "stranded".to_string(),
                notes: String::new(),
                list_id: "no-such-list".to_string(),
                created_at: 1_700_000_000_000,
                done_at: None,
                binned_at: None,
            }],
        };

        let dst = Doc::new().unwrap();
        let summary = dst.import_json(&export).unwrap();
        assert_eq!(summary.items_added, 1);
        assert_eq!(summary.lists_added, 0);

        let items: Vec<ItemView> = dst.iter_items().collect();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].text, "stranded");
        assert_eq!(items[0].list_id, LIST_MAIN);
    }

    #[test]
    fn import_json_str_round_trips_through_serde() {
        let src = Doc::new().unwrap();
        let l = src.add_list("Roundtrip").unwrap();
        let _ = src.add_item(&l, "via-string").unwrap();
        let json = src.export_json_string();

        let dst = Doc::new().unwrap();
        let summary = dst.import_json_str(&json).unwrap();
        assert_eq!(summary.lists_added, 1);
        assert_eq!(summary.items_added, 1);
    }

    #[test]
    fn import_json_rejects_unknown_version() {
        let export = JsonExport {
            version: 99,
            settings: ExportSettings {
                show_list_counts: false,
                main_name: None,
            },
            lists: vec![],
            items: vec![],
        };
        let dst = Doc::new().unwrap();
        let err = dst.import_json(&export).unwrap_err();
        assert!(matches!(err, DocError::Invalid(_)));
    }

    #[test]
    fn import_json_emits_item_added_events() {
        let src = Doc::new().unwrap();
        let _ = src.add_item(LIST_MAIN, "e1").unwrap();
        let _ = src.add_item(LIST_MAIN, "e2").unwrap();
        let export = src.export_json();

        let dst = Doc::new().unwrap();
        let _ = dst.drain_events();
        dst.import_json(&export).unwrap();

        let evs = dst.drain_events();
        let added: Vec<&str> = evs
            .iter()
            .filter_map(|e| match e {
                AppEvent::ItemAdded { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(added.len(), 2);
        assert!(added.contains(&"e1"));
        assert!(added.contains(&"e2"));
    }

    #[test]
    fn apply_remote_emits_settings_changed_for_peer_toggle() {
        let dek = Dek::generate();
        let a = Doc::new().unwrap();
        let mut b = Doc::new().unwrap();

        // Counts default on, so the meaningful peer toggle is opting out.
        a.set_show_list_counts(false).unwrap();
        let blob = a.pending_export(&dek).unwrap().unwrap();

        b.apply_remote(&dek, &blob).unwrap();

        assert!(!b.get_settings().show_list_counts);
        assert!(matches!(
            b.drain_events().as_slice(),
            [AppEvent::SettingsChanged {
                show_list_counts: false,
                ..
            }]
        ));
    }

    #[test]
    fn export_snapshot_bytes_roundtrips_through_loro_import() {
        // Backup story: bytes from `export_snapshot_bytes` reconstruct
        // the same logical state when imported into a fresh Loro doc.
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
        let diff_capture = Arc::new(Mutex::new(DiffCapture::default()));
        let _diff_sub = restored_inner.subscribe_root(make_diff_subscriber(diff_capture.clone()));
        let restored = Doc {
            inner: restored_inner,
            last_pushed_vv: VersionVector::default(),
            item_index: Mutex::new(ProjectionIndex::default()),
            events: Mutex::new(VecDeque::new()),
            undo,
            diff_capture,
            _diff_sub,
        };
        restored.rebuild_index();

        // Fingerprint is the canonical "logical-equality" hash used
        // throughout the test suite to assert convergence — same hash
        // ⇒ same doc.
        assert_eq!(doc.fingerprint(), restored.fingerprint());
    }

    #[test]
    fn oplog_replay_rebuilds_item_index() {
        let source = Doc::new().unwrap();
        let id = source.add_item(LIST_MAIN, "replayed").unwrap();
        let updates = source.export_updates_after_bytes(&[]).unwrap();

        let mut restored = Doc::empty();
        restored.import_oplog_updates(&updates).unwrap();
        restored.move_item(&id, LIST_MAIN, 0).unwrap();

        assert_eq!(restored.get_item(&id).unwrap().text, "replayed");
    }

    #[test]
    fn deferred_oplog_replay_rebuilds_once_and_stays_silent() {
        let source = Doc::new().unwrap();
        let first = source.add_item(LIST_MAIN, "first").unwrap();
        let first_updates = source.export_updates_after_bytes(&[]).unwrap();
        let after_first = source.oplog_vv_bytes();
        let second = source.add_item(LIST_MAIN, "second").unwrap();
        let second_updates = source.export_updates_after_bytes(&after_first).unwrap();

        let mut restored = Doc::empty();
        restored.replay_oplog_update(&first_updates).unwrap();
        restored.replay_oplog_update(&second_updates).unwrap();
        // Disposable lookups intentionally remain stale until the one
        // explicit completion point.
        assert!(restored.get_item(&first).is_none());
        restored.finish_oplog_replay();

        assert_eq!(restored.get_item(&first).unwrap().text, "first");
        assert_eq!(restored.get_item(&second).unwrap().text, "second");
        assert!(restored.drain_events().is_empty());
        assert!(!restored.can_undo());
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
        assert_eq!(evs, vec![AppEvent::ItemRemoved { id: id.clone() }]);

        assert!(doc.redo().unwrap());
        let evs = doc.drain_events();
        assert_eq!(evs.len(), 1);
        assert!(matches!(
            &evs[0],
            AppEvent::ItemAdded { id: event_id, .. } if event_id == &id
        ));
    }

    #[test]
    fn undo_move_emits_only_the_moved_item() {
        let doc = Doc::new().unwrap();
        let texts: Vec<String> = (0..200).map(|i| format!("item {i}")).collect();
        let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        let ids = doc.add_items_at(LIST_MAIN, &refs, 0).unwrap();
        let _ = doc.drain_events();

        let moved = ids[199].clone();
        doc.move_item(&moved, LIST_MAIN, 0).unwrap();
        let _ = doc.drain_events();
        assert!(doc.undo().unwrap());

        let evs = doc.drain_events();
        assert_eq!(evs.len(), 1, "undo should be surgical: {evs:?}");
        assert!(matches!(
            &evs[0],
            AppEvent::ItemMoved {
                id,
                live_index: Some(199),
            } if id == &moved
        ));
        assert_eq!(doc.live_item_ids(LIST_MAIN), ids);
    }

    #[test]
    fn undo_redo_round_trips_cross_list_move() {
        let doc = Doc::new().unwrap();
        let other = doc.add_list("Other").unwrap();
        let a = doc.add_item(LIST_MAIN, "a").unwrap();
        let b = doc.add_item(LIST_MAIN, "b").unwrap();
        let c = doc.add_item(LIST_MAIN, "c").unwrap();
        let o = doc.add_item(&other, "o").unwrap();
        let _ = doc.drain_events();

        // Cross-list move is one commit — one undo step.
        doc.move_item(&b, &other, 1).unwrap();
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a.clone(), c.clone()]);
        assert_eq!(doc.live_item_ids(&other), vec![o.clone(), b.clone()]);

        assert!(doc.undo().unwrap());
        assert_eq!(
            doc.live_item_ids(LIST_MAIN),
            vec![a.clone(), b.clone(), c.clone()],
            "undo restores the item to its former position in the source list"
        );
        assert_eq!(doc.live_item_ids(&other), vec![o.clone()]);
        assert_eq!(doc.get_item(&b).unwrap().list_id, LIST_MAIN);
        assert_live_projection_matches_doc(&doc);

        assert!(doc.redo().unwrap());
        assert_eq!(doc.live_item_ids(LIST_MAIN), vec![a, c]);
        assert_eq!(doc.live_item_ids(&other), vec![o, b.clone()]);
        assert_eq!(doc.get_item(&b).unwrap().list_id, other);
        assert_live_projection_matches_doc(&doc);
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
