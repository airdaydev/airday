//! Domain-level change events emitted by `Doc` after every commit
//! (local mutation) or remote import. Local mutation methods push
//! exact events surgically; remote imports are translated from Loro's
//! per-container diffs by `Doc::translate_captured_diffs`. Bulk/opaque
//! frames emit one `FullResync` control event instead of N synthetic item
//! events.
//!
//! These are the contract between the core and every UI layer. A
//! consumer (Solid store, SwiftUI `@Observable`, Compose `StateFlow`)
//! mirrors each event into its native reactive primitive with a
//! surgical write — no diff or reconciliation needed at the UI layer.
//!
//! Initial attachment materializes current state explicitly. After that,
//! consumers receive live deltas or an occasional `FullResync` request.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
    /// The doc changed by a bulk or opaque operation that is cheaper and
    /// safer for consumers to rematerialize wholesale. This is a control
    /// signal only: consumers fetch one current-state snapshot rather than
    /// receiving thousands of synthetic per-item events.
    FullResync,

    // ---------- items ----------
    /// New item appeared (local add or remote insert), or backfill on
    /// initial attach. `live_index` is the position within the *live*
    /// projection of `list_id` (done/binned excluded) — `None` when the
    /// item is not live. UI layers that keep per-list arrays splice at
    /// `live_index`. There is no global item order in the v2 schema, so
    /// there is no doc-wide index.
    ItemAdded {
        id: String,
        list_id: String,
        text: String,
        notes: String,
        created_at: i64,
        done_at: Option<i64>,
        binned_at: Option<i64>,
        live_index: Option<usize>,
    },
    /// Item removed from the doc (deleteBinned / emptyBin). Toggling
    /// `binned_at` does *not* emit this — that emits
    /// `ItemStatusChanged`.
    ItemRemoved {
        id: String,
    },
    /// Item changed position within its list's order (an in-list
    /// reorder, or a passive shift caused by a neighbour's move).
    /// Cross-list moves emit `ItemListChanged` instead. `live_index` is
    /// the item's resulting position within its list's live projection;
    /// `None` when the item is done/binned, whose ordering is
    /// view-local (timestamp sorts), not CRDT order.
    ItemMoved {
        id: String,
        live_index: Option<usize>,
    },
    ItemTextChanged {
        id: String,
        text: String,
    },
    ItemNotesChanged {
        id: String,
        notes: String,
    },
    /// Done/binned flags changed. The two are independent — an event is
    /// emitted whenever either timestamp transitions on/off, and the
    /// payload carries both current values so consumers can mirror state
    /// without tracking the previous one. `live_index` is the item's
    /// position within its list's live projection when the item is live
    /// after the change (restore / un-done re-entry point); `None` when
    /// it is done/binned (consumers drop it from the live array).
    ItemStatusChanged {
        id: String,
        done_at: Option<i64>,
        binned_at: Option<i64>,
        live_index: Option<usize>,
    },
    /// Item's `list_id` field changed without changing position
    /// (e.g. orphan reassignment when a list is deleted), or alongside
    /// an `ItemMoved` (cross-list drag). `live_index` is the item's
    /// position within the *new* list's live projection; `None` when
    /// the item is done/binned.
    ItemListChanged {
        id: String,
        list_id: String,
        live_index: Option<usize>,
    },

    // ---------- lists ----------
    ListAdded {
        id: String,
        name: String,
        created_at: i64,
        index: usize,
    },
    ListRemoved {
        id: String,
    },
    ListMoved {
        id: String,
        index: usize,
    },
    ListRenamed {
        id: String,
        name: String,
    },

    // ---------- workspace settings ----------
    /// Doc-level synced settings changed. The payload carries the
    /// current known value for each surfaced field so consumers can
    /// mirror a small settings object with a single write.
    SettingsChanged {
        /// When true, clients render each non-Queue list's live-item
        /// count in the nav (subject to the count > 0 gate). Queue
        /// always shows its count regardless. Single global flag —
        /// there is no per-list override.
        show_list_counts: bool,
        /// `None` when the user hasn't overridden Queue's display name;
        /// clients should fall back to the localized built-in label.
        main_name: Option<String>,
    },
}
