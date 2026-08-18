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

use crate::doc::DefaultView;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppEvent {
    /// The doc changed by a bulk or opaque operation that is cheaper and
    /// safer for consumers to rematerialize wholesale. This is a control
    /// signal only: consumers fetch one current-state snapshot rather than
    /// receiving thousands of synthetic per-item events.
    FullResync,

    // ---------- items ----------
    /// New item appeared (local add or remote insert), or backfill on
    /// initial attach. `open_index` is the position within the *Open*
    /// projection of `list_id` (Backlog + Live, i.e. done/binned excluded)
    /// — `None` when the item is not open. UI layers that keep per-list
    /// Open arrays splice at `open_index`. There is no global item order
    /// in the v2 schema, so there is no doc-wide index.
    ItemAdded {
        id: String,
        list_id: String,
        text: String,
        notes: String,
        created_at: i64,
        done_at: Option<i64>,
        binned_at: Option<i64>,
        /// Lifecycle flag (`spec/data-model.md`): `true` ≡ Live, `false`
        /// ≡ Backlog. Combined with `done_at`/`binned_at` (precedence
        /// Binned > Done > Live > Backlog) it resolves the item's lane.
        live: bool,
        /// Date-only due date (`YYYY-MM-DD`) or `None`. Floating local
        /// calendar date — consumers format without timezone conversion.
        due_on: Option<String>,
        open_index: Option<usize>,
    },
    /// Item removed from the doc (deleteBinned / emptyBin). Toggling
    /// `binned_at` does *not* emit this — that emits
    /// `ItemLifecycleChanged`.
    ItemRemoved {
        id: String,
    },
    /// Item changed position within its list's order (an in-list
    /// reorder, or a passive shift caused by a neighbour's move).
    /// Cross-list moves emit `ItemListChanged` instead. `open_index` is
    /// the item's resulting position within its list's Open projection;
    /// `None` when the item is done/binned, whose ordering is
    /// view-local (timestamp sorts), not CRDT order.
    ItemMoved {
        id: String,
        open_index: Option<usize>,
    },
    ItemTextChanged {
        id: String,
        text: String,
    },
    ItemNotesChanged {
        id: String,
        notes: String,
    },
    /// Item's date-only due date changed. The payload is the raw
    /// `YYYY-MM-DD` value after the write — `None` when cleared. The
    /// value is a floating local calendar date; consumers format it
    /// locally without timezone conversion.
    ItemDueChanged {
        id: String,
        due_on: Option<String>,
    },
    /// Lifecycle changed (`spec/data-model.md`). The three stored fields
    /// are independent — an event is emitted whenever any of `live`,
    /// `done_at` or `binned_at` transitions, and the payload carries all
    /// current values so consumers can resolve the lane by precedence
    /// (Binned > Done > Live > Backlog) without rereading the doc.
    /// `open_index` is the item's position within its list's Open
    /// projection when the item is open after the change (restore /
    /// un-done re-entry point, or a Backlog↔Live flip that keeps it in
    /// place); `None` when it is done/binned (consumers drop it from the
    /// Open array).
    ItemLifecycleChanged {
        id: String,
        live: bool,
        done_at: Option<i64>,
        binned_at: Option<i64>,
        open_index: Option<usize>,
    },
    /// Item's `list_id` field changed without changing position
    /// (e.g. orphan reassignment when a list is deleted), or alongside
    /// an `ItemMoved` (cross-list drag). `open_index` is the item's
    /// position within the *new* list's Open projection; `None` when
    /// the item is done/binned.
    ItemListChanged {
        id: String,
        list_id: String,
        open_index: Option<usize>,
    },

    // ---------- lists ----------
    ListAdded {
        id: String,
        name: String,
        created_at: i64,
        /// Archive timestamp (`spec/data-model.md` "Archived lists"):
        /// `Some` when the list is archived. Carried here — not just on
        /// `ListArchivedChanged` — because snapshot/backfill consumers
        /// must materialize archived lists correctly from the add burst.
        archived_at: Option<i64>,
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
    /// A user-created list's display icon was set or cleared. `icon` is
    /// the literal emoji grapheme after the change, or `None` when the
    /// icon was removed (consumers fall back to the built-in glyph).
    ListIconChanged {
        id: String,
        icon: Option<String>,
    },
    /// A user-created list's saved default view was set or cleared
    /// (`spec/board.md`). `view` is the value after the change; `None`
    /// means no saved default, so clients fall back to their own. The
    /// reserved `inbox` list has no ListMeta row — its default rides on
    /// `SettingsChanged.inbox_view` instead. A client that has its own
    /// local override for this list keeps it; the default only decides
    /// what an un-overridden client renders.
    ListDefaultViewChanged {
        id: String,
        view: Option<DefaultView>,
    },
    /// A user-created list was archived or unarchived
    /// (`spec/data-model.md` "Archived lists"). `archived_at` is the
    /// value after the change — `Some(ts)` when archived, `None` when
    /// restored to the active workspace. Metadata-only: no item, order,
    /// lifecycle, or Focus events accompany it.
    ListArchivedChanged {
        id: String,
        archived_at: Option<i64>,
    },

    // ---------- focus ----------
    /// The Focus lens (`spec/focus.md`) changed — a ref was added, removed,
    /// reordered, or swept, including the auto-removal when a focused item
    /// goes Done. Carries no payload: visibility depends on item lifecycle
    /// too, so consumers re-derive `focus_view()` on this event *and* on
    /// item events. Emitted once per focus-mutating commit.
    FocusChanged,

    // ---------- workspace settings ----------
    /// Doc-level synced settings changed. The payload carries the
    /// current known value for each surfaced field so consumers can
    /// mirror a small settings object with a single write.
    SettingsChanged {
        /// When true, clients render each non-Inbox list's open-item
        /// count (Backlog + Live) in the nav (subject to the count > 0
        /// gate). Inbox always shows its count regardless. Single global flag —
        /// there is no per-list override.
        show_list_counts: bool,
        /// The reserved `inbox` list's saved default view (`spec/board.md`),
        /// or `None` when none is saved. Inbox has no ListMeta row, so its
        /// default travels on the settings event rather than
        /// `ListDefaultViewChanged`.
        inbox_view: Option<DefaultView>,
    },
}
