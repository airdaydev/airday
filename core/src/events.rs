//! Domain-level change events emitted by `Doc` after every commit
//! (local mutation) or remote import. The translation from Loro's
//! per-container diffs to these events lives in `doc::events_translator`.
//!
//! These are the contract between the core and every UI layer. A
//! consumer (Solid store, SwiftUI `@Observable`, Compose `StateFlow`)
//! mirrors each event into its native reactive primitive with a
//! surgical write — no diff or reconciliation needed at the UI layer.
//!
//! On first attach the consumer receives a synthetic burst representing
//! current state (`ListAdded` / `ItemAdded` for everything that exists),
//! then live deltas. Both flow through the same code path.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
    // ---------- items ----------
    /// New item appeared (local add or remote insert), or backfill on
    /// initial attach. `index` is the position in the global items
    /// MovableList — UI layers track a single global order and filter
    /// per view.
    ItemAdded {
        id: String,
        list_id: String,
        text: String,
        created_at: i64,
        done_at: Option<i64>,
        binned_at: Option<i64>,
        index: usize,
    },
    /// Item removed from the doc (deleteBinned / emptyBin). Toggling
    /// `binned_at` does *not* emit this — that emits
    /// `ItemStatusChanged`.
    ItemRemoved {
        id: String,
    },
    /// Item changed position in the global items MovableList. Emitted
    /// for both intra-list reorders and inter-list moves; the
    /// accompanying `ItemListChanged` (if any) carries the new list_id.
    ItemMoved {
        id: String,
        index: usize,
    },
    ItemTextChanged {
        id: String,
        text: String,
    },
    /// Done/binned flags changed. The two are independent — an event is
    /// emitted whenever either timestamp transitions on/off, and the
    /// payload carries both current values so consumers can mirror state
    /// without tracking the previous one.
    ItemStatusChanged {
        id: String,
        done_at: Option<i64>,
        binned_at: Option<i64>,
    },
    /// Item's `list_id` field changed without changing position
    /// (e.g. orphan reassignment when a list is deleted), or alongside
    /// an `ItemMoved` (cross-list drag).
    ItemListChanged {
        id: String,
        list_id: String,
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
}
