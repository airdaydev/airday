# Board (lifecycle view)

Board view is a **second lens on an existing list**, not a new container kind.
Every list (including the reserved `inbox`) can be viewed as a board. Archiving
a list (`spec/data-model.md` "Archived lists") changes nothing here: an
archived list's board — lanes, order, saved view — remains intact and renders
normally when the list is opened from the archived section. The board
has **three fixed lanes** driven by item lifecycle — there are no user-created,
renamed, reordered, or deleted lanes:

```
Backlog | Live | Done
```

Bin is **not** a lane. Binned items are the existing global discarded-items
view (`spec/data-model.md`), reachable from the nav, not the board.

The flat list view and the board share one order. The list view shows the
list's **Open** projection (Backlog + Live) in their single manual order;
the board splits that same Open order into the Backlog and Live lanes and adds
a Done lane. Moving an item between lanes changes its lifecycle
(`spec/data-model.md` "Lifecycle"); it does not reorder anything by itself.

## Lanes

- **Backlog** — the list's Open items with `live != true`, in list order.
- **Live** — the list's Open items with `live == true`, in list order.
- **Done** — the list's items that are done-but-not-binned
  (`done_at != null && binned_at == null`), sorted by `done_at` **descending**
  (id asc tiebreak). Scoped to the current list. This is the per-list slice of
  the global Done view.

Backlog and Live **preserve relative order** from the list's Open projection:
an item's position is the same whether you read `order/<list-id>` linearly or
read the two lanes top-to-bottom. Flipping `live` moves an item between the two
lanes without changing its underlying order entry.

## Projection

- The board reads the list's Open projection (the core's per-list `open`
  index — see `spec/data-model.md`) and partitions it by the `live` flag on
  each `ItemView`. No new core projection is needed; Backlog and Live are two
  views of one ordered array.
- Done is a timestamp sort over the list's done-but-not-binned items, exactly
  the global Done view filtered to this `list_id`.
- `ItemView` carries `live`, `done_at`, `binned_at`; `ItemView::lifecycle()`
  resolves the displayed lane by precedence.

## Interactions

Every lane move is one `set_item_lifecycle` commit (`spec/data-model.md`):

- **Drop into Backlog** — set lifecycle Backlog (clear `live`, `done_at`,
  `binned_at`). If the drop names a target position in the shared Open order,
  fold a `move_item` reorder into the same commit.
- **Drop into Live** — set lifecycle Live (`live = true`; clear `done_at`,
  `binned_at`), same optional reorder.
- **Drop into Done** — set lifecycle Done (set `done_at`; clear `binned_at`;
  **preserve `live`**), so un-doing later reveals the correct Backlog/Live
  lane. Done is timestamp-ordered, so a drop position within Done is ignored.
- **Drop from Done into Backlog / Live** — the target lane explicitly selects
  the lifecycle (Backlog clears `live`, Live sets it); `done_at` clears.

## Capture

- Adding in the **Backlog** lane creates the item directly as Backlog (normal
  `add_item` — `live` omitted).
- Adding in the **Live** lane creates the item directly as Live (`add_item`
  then set Live, or an add variant that sets `live` in the same commit).
- The list view's capture creates Backlog items (`add` default).

## Default view

A list carries an optional **saved default view**: the lens a client renders it
in before that client overrides it locally. It is synced doc state — one
encoded scalar register on the list's `ListMeta` (`view`), or on the doc-level
`settings` map (`inbox_view`) for the reserved `inbox`, which has no ListMeta
row. See `spec/data-model.md`.

```
DefaultView = "list" | "board" | "board:nodone"
```

The whole view is one register, not a mode flag plus a Done-lane flag, so a
concurrent save on another device replaces it atomically rather than merging a
mode from one device with a lane flag from another (same rationale as
`Location`). The list lens carries no Done-lane state — it always encodes as
bare `"list"` — so two specs that render identically also compare identically.

Resolution, per list, on every client:

```
local override (if any)  →  saved default (if any)  →  built-in flat list
```

- Absent ≡ "no saved default", including a value written by a newer client that
  this build doesn't recognize: an unparseable register reads as absent, so a
  future lens degrades to the local fallback rather than rendering something
  wrong.
- The default only decides what an **un-overridden** client renders. Changing
  it never disturbs a client that has its own override.
- `set_default_view(list_id, view)` accepts the reserved `inbox`; that write
  lands in `settings` and surfaces as `SettingsChanged`, not
  `ListDefaultViewChanged`.
- Export/import carries it: `ExportList.view` per user list and
  `ExportSettings.inbox_view` for Inbox, both in encoded form. Import applies
  per-list views to the fresh lists it creates; like every other doc-level
  setting, Inbox's is exported for fidelity but not applied by the additive
  importer.

## Client (web) contract

- Per-list view mode (list ⇄ board, plus the board's Done lane) resolves as
  above: a **local override** in `localStorage` (`airday:list-view`, a map of
  list id ⇒ encoded view) wins over the synced default. The same account may
  want a board on desktop and a flat list on a phone.
- The override map holds only genuinely divergent lists. Choosing a view that
  matches what the client would render anyway *drops* the override rather than
  pinning it, so a client that never diverges keeps following the account.
- The view-mode popover's "Save as default" publishes the current view to the
  doc and clears this client's override for that list (it now follows the
  default it just set). The action is disabled when the current view already is
  the saved default.
- Board renders three fixed lanes; there are no lane CRUD, rename, reorder, or
  menu affordances. The generic drag-and-drop infrastructure (placeholder,
  nudge, foreign-lane drop targets, one-transaction remove+insert) is retained;
  only custom-column-specific behaviour is removed.
- A Backlog↔Live drag is a same-list lifecycle change: the item is **not**
  spliced out of the list's Open array (`listOpen`), it stays in place and its
  lane is recomputed from `live`. Only Done/Binned transitions remove it from
  `listOpen`.

## Future

Custom grouping (user-defined lanes / fields) is intentionally left
**unspecified**. The board is deliberately coupled only to the lifecycle model,
not to any lane-definition storage, so a future grouping feature is unconstrained
by this spec.
