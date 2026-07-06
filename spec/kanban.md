# Kanban (board view + columns)

Board view is a **second lens on an existing list**, not a new container
kind. Every list (including the reserved `main`) can be viewed as a board.
Columns group a list's live items; grouping is a per-item register, ordering
stays the list's single `order/<list-id>` container. The linear list view and
the board view share one order — dragging within a column nudges the item's
linear position; changing its column never reorders anything by itself.

## Design summary

- **Grouping = per-item LWW register.** Item map gains an optional `column`
  key holding a column id. Absent ≡ default column.
- **Default column is implicit.** It is *the absence of a valid column id*,
  not a stored entity: it cannot be deleted, needs no seeding, and is the
  automatic fallback for any garbage. Lists that never use the board carry
  zero extra state.
- **Column defs live in one root container per list**, following the
  `order/<list-id>` precedent: `columns/<list-id>` (uniform for `main`, which
  has no ListMeta row).
- **Resolution rule (mirrors order-entry visibility):** an item's column
  register is honored iff it names an existing column of the item's *current*
  list; otherwise the item renders in the default column. Stale registers are
  harmless garbage — they can never place an item in a wrong or invisible
  group.

That last rule buys the hard cases for free:

- *Delete column* = remove its def. Every member falls to default with zero
  item writes; undoing the delete restores the grouping (registers were never
  touched).
- *Cross-list move racing a column change* cannot tear: whatever `location`
  wins, a column id from the wrong list resolves to default.
- *Concurrent column moves* of one item: LWW on the register.
- *Column change vs linear reorder*: independent writes, both apply.

## Doc layout (additive to schema v2)

No schema-version bump: every addition is a new root container, a new
optional map key, or a new optional field. v2 clients without column support
project the same lists and simply don't group.

- `doc.get_movable_list("columns/<list-id>")` — `LoroMovableList<LoroMap>`,
  one per list that has user-created columns. Each entry map:

  | Field | Type | Notes |
  |---|---|---|
  | `id` | string | uuid v7 hex; referenced by item `column` registers |
  | `name` | string | display name |
  | `created_at` | i64 | unix millis |

  Container order **is** board column order, with the implicit default
  column always pinned first. Entries are child maps (not encoded scalars)
  because `name` must be independently editable — same shape as the `lists`
  container. The container for a deleted list is abandoned as unreachable
  history, like its order container.

- Item map: optional `column` key (string, column id). Written on its own —
  never folded into `location`. A cross-list move best-effort deletes the
  key in the same commit (the resolution rule makes a lost race harmless).

- ListMeta: optional `default_column_name` (string). Absent ≡ built-in label
  (client-localized, e.g. "To do"). Mutation trims and deletes the key on
  empty input — same contract as `main_name`.

- `settings`: optional `main_default_column_name` (string) — same override
  for the reserved `main` list, which has no ListMeta row. Same
  trim/delete-on-empty contract.

## Projection

- The board view of list `L` = `L`'s live projection partitioned by resolved
  column, preserving relative order within each group. Grouping happens at
  the client from `ItemView.column` + the column defs; the core's projection
  index is untouched (columns never affect order or membership).
- `ItemView` carries the **raw** register value; consumers resolve
  valid-or-default because they hold the column defs. Done/binned items keep
  their register (restore returns them to their former column if it still
  exists).
- Done and binned views ignore columns entirely.

## Mutation contracts (one Loro commit each)

- **add_column(list_id, name) → ColumnId** — push `{id, name, created_at}`
  onto `columns/<list_id>`. Trims; empty name rejected.
- **rename_column(list_id, column_id, name)** — register write on the entry
  map. Trims; empty rejected.
- **move_column(list_id, column_id, target_index)** — `mov` on the columns
  container. Index addresses user columns only (default is pinned first and
  not an entry).
- **delete_column(list_id, column_id)** — delete the entry from the
  container. Item registers are deliberately left in place (see above).
- **set_default_column_name(list_id, name)** — ListMeta key for user lists,
  `main_default_column_name` settings key for `main`. Empty clears.
- **set_item_column(item_id, column_id?, target_index?)** — validate the
  column exists on the item's current list (`None` targets the default
  column and clears the key); write/delete the register and, when
  `target_index` is given, apply the same-list reorder in the same commit.
  `target_index` addresses the **list's live projection** (global), exactly
  like `move_item` — the client derives it from the drop anchor. Without
  `target_index` the item keeps its linear position (menu/keyboard moves,
  drops into an empty column).
- **add_item_in_column(list_id, column_id, text) → ItemId** — normal append
  (`add_item` semantics) plus the register write, one commit. Board
  quick-capture into a column.
- **move_item(item, target_list, index)** — unchanged, plus: when the list
  changes, best-effort delete the `column` key in the same commit.
- **delete_list(list_id)** — unchanged (items relocate to `main` + binned),
  plus best-effort `column` key deletion on each item it already touches.
  The abandoned `columns/<list-id>` container joins the abandoned order
  container as unreachable history.
- **reconcile()** — unchanged for now. Clearing non-resolving column
  registers is a legal future extension but is deliberately not done in v1
  (an explicit reconcile between delete-column and its undo would otherwise
  destroy the restorable grouping).

## Events

New `AppEvent`s, mirroring the list events:

- `ItemColumnChanged { id, column: Option<String> }` — raw register value
  after the write.
- `ColumnAdded { list_id, id, name, created_at, index }` /
  `ColumnRenamed { list_id, id, name }` /
  `ColumnMoved { list_id, id, index }` /
  `ColumnRemoved { list_id, id }` — `index` is the position among user
  columns (default not counted).
- `DefaultColumnRenamed { list_id, name: Option<String> }` — one event for
  user lists *and* `main` (storage differs; the event doesn't).

`ItemAdded` gains a `column: Option<String>` payload field. `SettingsChanged`
keeps its shape — `main_default_column_name` surfaces via
`DefaultColumnRenamed`, including from remote settings diffs.
`snapshot_events` emits `ColumnAdded` bursts (after `ListAdded`s) plus
`DefaultColumnRenamed` for every list with an override set.

Remote/undo diff translation: `columns/<list-id>` diffs (container or nested
entry map) mark that list's columns dirty and are re-diffed wholesale against
the pre-state, like `lists` — columns are few. An item-map diff touching the
`column` key emits `ItemColumnChanged`.

## Fingerprint

Additions to the logical-state hash: per-item raw `column` register (with
presence byte); per-list `default_column_name` (ListMeta walk) and
`main_default_column_name` (settings section); a columns section hashing each
list's defs (id, name, created_at) in container order, lists walked in
canonical order (`main` first, then `lists` container order).

## JSON export/import

- `ExportList` gains `default_column_name: Option<String>` and
  `columns: Vec<{id, name, created_at}>` (omitted when empty).
- `ExportItem` gains `column: Option<String>`.
- Import creates fresh column ids per created list and maps item registers
  through; a register that doesn't map (unknown column, or the item fell
  back to `main`) is dropped — the item lands in the default column.
  Version stays 1; missing fields default via serde.

## Client (web) contract

- Per-list view mode (list ⇄ board) is a **local preference** (`prefs`), not
  synced doc state — the same account may want a board on desktop and a flat
  list on a phone.
- Board renders: default column first, then user columns in container order;
  each column is a vertical virtual list over the list's live projection
  filtered to that column. Column CRUD + rename-default in the board header.
- Cross-column drag is a same-list mutation: drop resolves to
  `set_item_column(item, col, global_index)` where `global_index` comes from
  the drop anchor's position in the list's live projection (drop at column
  end with no next-anchor ⇒ no `target_index`).
- Cross-column drag requires the shared-DragContext work in the dnd
  component (foreign-list placeholder/nudge, one-transaction remove+insert,
  empty-column drop targets, horizontal board autoscroll) — specified in
  `js/web/src/dnd/spec.md`, TODO there.
