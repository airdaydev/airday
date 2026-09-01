# Board (lifecycle view)

Board view is a **second lens on an existing list**, not a new container kind.
Every list (including the reserved `inbox`) can be viewed as a board. Archiving
a list (`spec/data-model.md` "Archived lists") changes nothing here: an
archived list's board — lanes, order, saved view — remains intact and renders
normally when the list is opened from the archived section. The board
has **five fixed lanes** driven by item lifecycle — there are no user-created,
renamed, reordered, or deleted lanes:

```
Backlog | Todo | In Progress | Review | Done
```

Bin is **not** a lane. Binned items are the existing global discarded-items
view (`spec/data-model.md`), reachable from the nav, not the board.

The lane *set* is fixed; lane *visibility* is not. A client may hide lanes
(see "Lane visibility" below) — a small board can render as few as two. Hiding
is display-only and never changes any item's state.

The flat list view and the board share one order. The list view shows the
list's **Open** projection (the four open states) in their single manual
order — the list view is the binary done | other lens: everything Open, with
Done and Binned elsewhere. The board splits that same Open order into the four
open lanes by lifecycle state and adds a Done lane. Moving an item between
lanes changes its lifecycle (`spec/data-model.md` "Lifecycle"); it does not
reorder anything by itself.

## Lanes

- **Backlog / Todo / In Progress / Review** — the list's Open items with the
  matching lifecycle state, in list order.
- **Done** — the list's done-but-not-binned items (`state == Done &&
  binned_at == null`), sorted by the workflow register's `at` **descending**
  (id asc tiebreak). Scoped to the current list. This is the per-list slice of
  the global Done view.

The open lanes **preserve relative order** from the list's Open projection:
an item's position is the same whether you read `order/<list-id>` linearly or
read the open lanes left-to-right, top-to-bottom. A lifecycle change moves an
item between lanes without changing its underlying order entry.

## Lane visibility

Clients may hide any lane except one (at least one lane always renders).
Hiding is a client-local display preference (it travels with neither the doc
nor the saved default view — see "Default view" for the one synced exception,
`board:nodone`):

- A hidden lane's items keep their state and their place in the shared Open
  order; they simply don't render on this client.
- A hidden lane is not a drop target; drags land only on visible lanes.
- Whether a hidden lane shows a collapsed stub (name + count) or vanishes
  entirely is a client presentation choice, not spec'd here.

This is what keeps five states from imposing five columns: a solo user can run
`Backlog | In Progress | Done`, or even just `In Progress | Done`, while a
team list shows all five.

## Projection

- The board reads the list's Open projection (the core's per-list `open`
  index — see `spec/data-model.md`) and partitions it by
  `ItemView::lifecycle()` into the four open lanes. No new core projection is
  needed; the open lanes are four views of one ordered array.
- Done is a timestamp sort over the list's done-but-not-binned items, exactly
  the global Done view filtered to this `list_id`.
- `ItemView` carries the lifecycle state and its `at` timestamp; the state is
  the displayed lane.

## Interactions

Every lane move is one `set_item_lifecycle` commit (`spec/data-model.md`) —
the target lane *is* the target state, uniformly:

- **Drop into an open lane** (Backlog / Todo / In Progress / Review) — set
  that lifecycle state. If the drop names a target position in the shared
  Open order, fold a `move_item` reorder into the same commit.
- **Drop into Done** — set lifecycle Done. Done is timestamp-ordered, so a
  drop position within Done is ignored.
- **Drop from Done into an open lane** — set that state; the item reappears in
  the Open order at its preserved entry position (drops naming a position fold
  the reorder in, as above).

## Capture

- Adding in an **open lane** creates the item directly in that lane's state
  (`add_item` — the `lifecycle` field omitted for Backlog; an add variant sets
  `[state, now]` in the same commit for the other three).
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

`"board:nodone"` (hide the Done lane) remains the only lane-visibility state
that syncs. Open-lane visibility is **client-local only** for now (see "Lane
visibility"); whether the saved default should some day carry a full visible-
lane set (e.g. `"board:backlog,inprogress,done"`) is an **open question** —
the register's unparseable ⇒ absent rule means such an extension degrades
safely on older clients, so nothing needs deciding before it's wanted.

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
- Board renders the five fixed lanes (minus locally hidden ones); there are no
  lane CRUD, rename, reorder, or menu affordances. The generic drag-and-drop
  infrastructure (placeholder, nudge, foreign-lane drop targets,
  one-transaction remove+insert) is retained; only custom-column-specific
  behaviour is removed.
- Open-lane visibility lives beside the view override in `localStorage`
  (client-local, per list). Hiding never mutates the doc.
- A drag between open lanes is a same-list lifecycle change: the item is
  **not** spliced out of the list's Open array (`listOpen`), it stays in place
  and its lane is recomputed from the lifecycle state. Only Done/Binned
  transitions remove it from `listOpen`.

## Future

Custom grouping (user-defined lanes / fields) is intentionally left
**unspecified**. The board is deliberately coupled only to the lifecycle model,
not to any lane-definition storage, so a future grouping feature is unconstrained
by this spec.
