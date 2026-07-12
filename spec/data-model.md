# Data Model

## Loro doc layout

One Loro doc per account. **Schema version 2** — see "Schema versioning &
compatibility" below; v2 docs must never sync with v1 clients.

- `doc.get_map("items")` — `LoroMap<ItemId, LoroMap>`: item identity and
  content. Keyed by the item's stable UUID; each value is a child `LoroMap`
  (one Item, below). Items live here for their whole lifetime regardless of
  which list they're in or whether they're done/binned.
- `doc.get_movable_list("lists")` — `LoroMovableList<LoroMap>` where each map
  is one ListMeta. Unchanged from v1.
- `doc.get_map("settings")` — `LoroMap` for account-wide synced workspace
  settings. Unchanged from v1.
- `doc.get_movable_list("order/<list-id>")` — one **order container** per
  logical list (`order/inbox` for the built-in list). Entries are **encoded
  scalar strings only** (OrderEntry, below) — never child containers. The
  order container carries ordering; the `items` map carries everything else.
- `doc.get_movable_list("focus")` — the reserved **focus container**: a curated
  list-by-reference of **encoded scalar FocusRef strings only** (never child
  containers). Its own element order *is* the Focus order. Additive within v2 —
  a focus-unaware client simply never projects it. See `spec/focus.md`.

There is **no document-wide item MovableList**. Reordering one list mutates
only that list's order container.

Historical `columns/<list-id>` containers may exist in old accounts (custom
board columns, removed). They are unreachable history: v2 code never opens
them and never projects them.

## Item

One child `LoroMap` under `items`, keyed by `ItemId`.

| Field | Type | Notes |
|---|---|---|
| `id` | string | same as the map key; kept inside the map so a container handle resolves back to its id during diff translation |
| `text` | string | the user's content |
| `notes` | string | optional richer text; empty string when absent in simple clients |
| `location` | string | **atomic placement register** — encoded `"<list_id>:<placement_id>"`, see below |
| `live` | bool? | lifecycle flag. Absent or `false` ≡ Backlog; `true` ≡ Live. New items omit it (Backlog). See "Lifecycle" below. |
| `due_on` | string? | optional **date-only** due date, a floating local calendar date in `YYYY-MM-DD` format (no time, no timezone, not unix millis). Absent ≡ no due date; clearing deletes the key. Values that are not a well-formed `YYYY-MM-DD` calendar date are rejected by the mutation. |
| `created_at` | i64 | unix millis (client clock) |
| `done_at` | i64? | set when lifecycle → Done |
| `binned_at` | i64? | set when lifecycle → Binned |

Item type is implicit (currently always text). Add an `item_type` field when
other kinds appear.

### Lifecycle

There is no single persisted `lifecycle` field. The persisted representation is
the `live` boolean plus the `done_at` / `binned_at` timestamps; the four-state
lifecycle is **derived** from them. The API-level enum is:

```
enum ItemLifecycle { Backlog, Live, Done, Binned }
```

Resolution precedence — **Binned > Done > Live > Backlog**:

- binned = `binned_at != null` (regardless of `live` / `done_at`)
- else done = `done_at != null`
- else live = `live == true`
- else Backlog

`done_at`, `binned_at` and `live` are **independent** stored fields. An item
may carry `done_at` *and* `binned_at` (done earlier, later binned) and may carry
`live == true` underneath either — the timestamps only *mask* the underlying
Backlog/Live state, which is revealed again when they clear (un-done, restore).

`ItemView::lifecycle()` returns the resolved `ItemLifecycle`. The **Open**
projection (Backlog + Live) is `done_at == null && binned_at == null` — i.e.
neither done nor binned, exactly the old "live view".

**Concurrency.** `live`, `done_at` and `binned_at` are three independent LWW
registers. Concurrent lifecycle writes converge per-field by last-writer-wins,
then the precedence rule resolves the merged fields deterministically — every
replica derives the same `ItemLifecycle` from the same field values, so
lifecycle never diverges. (Example: device A marks an item Done while device B
marks it Backlog; `done_at` and `live` each merge by LWW, and precedence shows
Done as long as `done_at` survives.)

`Binned` and `Done` items keep their `location` (and therefore their logical
list membership) so "restore to original list" works, and keep their `live`
flag so restore/un-done reveal the correct Backlog/Live state. Hard delete (e.g.
emptying the bin) removes the key from the `items` map — Loro handles the
tombstone — and best-effort removes the item's order entries.

## Location and placement IDs

```
Location   = "<list_id>:<placement_id>"     (value of item.location)
OrderEntry = "<item_id>:<placement_id>"     (element of order/<list_id>)
FocusRef   = "<item_id>"                     (element of focus; local doc)
           = "<doc_id>:<item_id>"            (future: cross-doc — see spec/focus.md)
```

All three are single **encoded scalar strings**. Rationale (vs a structured
`LoroValue::Map`): a scalar register is written in one op, so `list_id` and
`placement_id` can never be torn apart by concurrent edits — there are no
independently-mergeable sub-fields to conflict. It is also smaller on the wire
and trivially comparable. The separator `:` is reserved: ids are uuid-v7 hex
(`[0-9a-f]{32}`) or the literal `inbox`, so it can never appear inside a
component. Parsing splits on the **first** `:`. (A bare `FocusRef` has no `:` and
is a local-doc item id; the emitter writes only this form today — see
`spec/focus.md`.)

A `placement_id` is a fresh uuid-v7 generated whenever an item is *placed*
into a list (add, cross-list move, delete-list reassignment). It is **not**
regenerated by within-list reorders, lifecycle changes, or content edits.

### Why placement IDs are required

A cross-list move is a delete-plus-insert across two order containers plus a
`location` register write. Two devices concurrently moving the same item to
different lists each insert an entry into a different container; the CRDT
keeps both inserts. The item's `location` register resolves the conflict
(last-writer-wins on the whole atomic value); the losing insert becomes a
**stale entry**. An order entry is *visible* only when it matches the item's
winning location:

```
visible(entry in order/L) :=
       items[entry.item_id] exists
    && items[entry.item_id].location.list_id == L
    && items[entry.item_id].location.placement_id == entry.placement_id
    && no earlier visible entry in order/L has the same item_id
```

Stale and duplicate entries are therefore harmless garbage: they can never
make an item visible (wrong placement), never duplicate a visible item (first
match wins), and can be cleaned opportunistically (see Reconciliation).

## Projection invariants

- **Item location is authoritative.** The `items` map + `location` register
  fully determine which list every item belongs to. Order containers only
  order; they never own membership.
- **Stale order entries never make an item visible.** (Visibility rule
  above.)
- **Duplicate entries produce one visible item.** First visible match in
  container order wins; later duplicates are ignored.
- **Missing canonical entries never hide data.** An item whose `location`
  names list `L`/placement `p` but has no matching entry in `order/L` (lost
  to concurrent deletion, partial history, or bugs) is still projected: it is
  appended after all entry-backed items of `L`, in `(created_at, id)`
  ascending order — deterministic across replicas. This is the **fallback
  tail**.
- **Reads never mutate.** Projection (including the fallback tail) is pure;
  it never writes order entries. Materializing fallback placements into real
  entries happens only through the explicit reconciliation mutation.
- Done and binned semantics are unchanged from v1: the Done view sorts by
  `done_at` desc (id asc tiebreak), the Bin view by `binned_at` desc; both are
  timestamp sorts, not order-container projections.

### Resolved order

The **resolved order** of list `L` = visible entries of `order/L` in
container order, then the fallback tail. It covers items of *all* lifecycles
(backlog, live, done, binned) that locate to `L`. The **Open** projection of
`L` (Backlog + Live) is the resolved order filtered to open items (`done_at ==
null && binned_at == null`). Backlog and Live share this single order — the
`live` flag partitions Open into two board lanes without reordering. The
resolved order — not just the Open projection — is part of logical state (it
fixes restore positions), so `doc_fingerprint` hashes it. The **Focus order** is
logical state too (it fixes the curated Focus sequence), so `doc_fingerprint`
hashes the focus container's order as well (`spec/focus.md`).

## Done / binned items stay in the order container

**Decision:** flipping `done_at` / `binned_at` does **not** touch order
containers. A hidden item's entry stays where it is; restore simply makes the
item visible again in exactly its former position.

Tradeoffs considered:

- *Keep entries (chosen)*: restore is deterministic and exact for free; done/
  bin toggles are single map writes (cheap, clean undo steps, no concurrent
  order churn). Cost: an order container's length grows with the list's
  *lifetime* item count, so projecting a list is O(lifetime items in that
  list). At the 13k-lifetime-items yardstick this matches today's cost for
  `inbox` while making every *other* list's projection proportional to its own
  history — and hard delete (bin emptying) is the natural pruning mechanism:
  deleting a binned item removes its entry.
- *Remove entries + restoration anchors (rejected)*: keeps order containers
  live-only (faster projection) but restore needs anchor bookkeeping that is
  itself concurrency-prone (anchor deleted/moved/hidden), turns every done/
  bin toggle into a two-container mutation, and makes undo of a lifecycle flip a
  structural edit. Complexity concentrated on the most common mutation in the
  product; rejected.

## Mutation contracts

Every mutation below forms **one Loro commit** (one undo step, one op group).

- **Add item** — create the item map in `items` (id, text, created_at),
  generate a placement id, set `location = target:placement` atomically,
  insert `"item:placement"` into `order/target` at the requested position.
- **Reorder within one list** — `MovableList::mov` on the list's order
  container. The placement id is preserved; `location` is untouched.
- **Move across lists** — generate a fresh placement id; set the new
  `location` atomically; insert the matching entry into the target order
  container; best-effort delete the old entry (and any other entries for
  this item) from the source order container. Concurrent moves converge via
  the location register; the loser's entry goes stale.
- **Set lifecycle** — every lifecycle transition is **one Loro commit** on the
  item map only (order containers are untouched — see decision above). The
  displayed state is derived by precedence (Binned > Done > Live > Backlog), so
  transitions write the *stored* fields directly:

  | Target | `live` | `done_at` | `binned_at` |
  |---|---|---|---|
  | Backlog | clear | clear | clear |
  | Live | set `true` | clear | clear |
  | Done | *preserve* | set now | clear |
  | Binned | *preserve* | *preserve* | set now |

  Two convenience transitions are the inverses of Done/Binned and preserve the
  masked state rather than setting it:

  - **Un-done** — clear `done_at` only, revealing the preserved Backlog/Live
    state (`live`).
  - **Restore from Bin** — clear `binned_at` only, revealing the preserved
    underlying state (which may itself be Done, if the item was done before it
    was binned).

  Because Backlog↔Live is a single `live`-register write and Done/Binned are
  single timestamp writes, an item's order entry never moves on a lifecycle
  change; restore/un-done reveal it in its former position (or the fallback
  tail if its entry was lost). Board drops that additionally reorder within the
  shared Open order fold the `move_item` reorder into the *same* commit.

  **Focus exception (the one second-container write).** The **Done** transition
  additionally removes the item's focus ref(s) from the `focus` container in the
  same commit, so completing an item removes it from Focus and it does not return
  on un-done. This is the sole lifecycle transition that touches a container other
  than the item map; it is justified because a Done focus ref renders nothing (the
  Focus view is Open-only) and Focus must stay finite without relying on the
  unwired `reconcile()`. **Binned does not** touch the focus container — binned
  refs are filtered from the view and swept on the next focus interaction. See
  `spec/focus.md` "Lifecycle interplay".
- **Hard delete** — delete the item's key from `items`; best-effort remove
  its entries from its located order container. Entries elsewhere are
  invisible anyway (item lookup fails) and left to reconciliation.
- **Delete list** — refuses for `inbox`. Deleting a list *discards its
  contents to the bin* rather than dumping them into Home's Open view. Every item
  locating to the list (open, done *and* binned) is moved to `inbox` with a
  fresh placement, appended to `order/inbox` in the deleted list's resolved
  order, and — unless it was already binned — marked binned with a shared
  `binned_at` timestamp (already-binned items keep their original one). The
  relocation to `inbox` gives each item a real home list for when it is later
  restored from the bin; the bin move keeps discarded items out of every
  live view without losing them. The ListMeta row is deleted. The abandoned
  `order/<list-id>` container remains as unreachable history (root containers
  can't be deleted; it simply stops being projected).

### Reconciliation

`reconcile()` is an explicit, idempotent maintenance mutation (never run
implicitly by reads): for every list it removes stale/duplicate entries and
appends real entries for fallback-tail items (using each item's existing
placement id). It also prunes **focus** refs that are missing / done / binned /
foreign and dedups them (`spec/focus.md`). One commit; a no-op when the doc is
clean. Clients may run it opportunistically (e.g. after bootstrap); nothing
depends on it running — Focus stays bounded via auto-remove-on-Done and the
sweep folded into each focus mutation.

## ListMeta

| Field | Type | Notes |
|---|---|---|
| `id` | string | uuid v7 hex; stable, used in `Location.list_id` |
| `name` | string | display name |
| `created_at` | i64 | unix millis |

Whether the nav shows an open-item count (Backlog + Live) beside each list is governed by a single doc-level flag — see `WorkspaceSettings.show_list_counts`. There is no per-list override; Inbox's count is always shown regardless.

## Built-in lists

Airday has one reserved primary capture list:

- `inbox` — rendered as "Inbox". This id is reserved and addressable by items,
  but it is not stored as a `ListMeta` row in the `lists` MovableList. Its
  order container is `order/inbox`. Its label is currently client-defined and
  it is non-renamable, non-movable, and non-deletable. Doc-level settings for
  it live in `settings`. (Pre-rename docs stored this id as `main`; the JSON
  importer aliases `main` ⇒ `inbox` for the reserved list — see "Schema
  versioning & compatibility".)

The bin is *not* a list; it's the `Binned` lifecycle on items.

**Focus** is a reserved lens, not a list — the `focus` container of FocusRefs
(`spec/focus.md`), projected as a flat ordered view of Open referenced items. It
is non-renamable and non-deletable, and like the bin it is not a `ListMeta` row.

## WorkspaceSettings

Doc-level synced settings that are not owned by any specific `ListMeta`.

| Field | Type | Notes |
|---|---|---|
| `show_list_counts` | bool? | when true, clients render each non-Inbox list's open-item count (Backlog + Live) in the nav (subject to a `count > 0` gate). Inbox's count is always shown regardless. Absent ≡ false; the mutation deletes the key on the off path so an unset flag leaves no on-disk trace. |
| `inbox_name` | string? | user-chosen display-name override for the reserved `inbox` (Inbox) list. Absent ≡ no override; clients fall back to the localized built-in label. The mutation deletes the key on empty/whitespace input so an unset override leaves no on-disk trace. (Stored settings key: `inbox_name`.) |

## Mutations (rust core API surface)

All mutations go through Loro APIs internally; the core exposes typed helpers:

- `add_item(list_id, text) -> ItemId`
- `move_item(item_id, target_list_id, target_index)` — in-list reorder when
  `target_list_id` equals the current list (order `mov`, placement kept);
  cross-list move otherwise (fresh placement, atomic location write,
  entry delete+insert). One commit either way.
- `set_item_lifecycle(item_id, lifecycle)` / `set_items_lifecycle(item_ids, lifecycle)` — move one or many items to an `ItemLifecycle` (`Backlog | Live | Done | Binned`) in a single commit, writing `live` / `done_at` / `binned_at` per the transition table above. This is the primitive the board uses; the `done`/`bin`/`restore`/`un-done` helpers below are convenience wrappers over it.
- `edit_item_text(item_id, text)`
- `set_item_due_on(item_id, due_on)` — `Some(date)` validates a `YYYY-MM-DD`
  calendar date and writes the `due_on` register; `None` deletes the key. One
  commit. Rejects malformed dates with `Invalid`.
- `add_list(name) -> ListId`
- `rename_list(list_id, name)`
- `set_show_list_counts(show)` — toggles the doc-level "show counts on non-Inbox lists" flag. Inbox's count is always visible (subject to count > 0) and is not gated by this.
- `set_inbox_name(name)` — sets or clears the reserved `inbox` (Inbox) list's display-name override in the doc-level `settings` map. Trims input; an empty trimmed string clears the override.
- `delete_list(list_id)` — refuses for `inbox`; see "Delete list" contract above.
- `empty_bin()` — hard-deletes all `Binned` items.
- `delete_binned(item_id)` — hard-deletes one `Binned` item.
- `add_to_focus(item_id, index)` / `remove_from_focus(item_id)` / `move_in_focus(item_id, index)` — curated Focus lens mutations over the `focus` container (`spec/focus.md`). Each is one commit and sweeps dead focus refs. `add_to_focus` no-ops when the item already has a visible ref.
- `focus_view()` / `focus_refs()` — the Focus projection (Open, deduped, resolved order). Pure reads.
- `reconcile()` — explicit stale/duplicate/missing order-entry repair plus focus
  ref pruning/dedup; see Reconciliation.

The wire format for ops is whatever Loro emits — opaque bytes from the server's POV.

## Schema versioning & compatibility

This layout is a **breaking CRDT-schema change** from v1 (document-wide
`items` MovableList), and it is a **clean break** — no in-doc migration, no
legacy bridge, no data-carry-over guarantee while pre-release:

- The **wire protocol version stays at 1** (`spec/sync-protocol.md`): frames
  are unchanged and op blobs are opaque to the protocol, and with a single
  pre-release user there are no old clients to fence off at the handshake.
  The cutover is operational: export JSON on the old build, wipe the
  account/local databases, import on the new build. (Loro root containers
  are typed by (name, type), so v2 code opening stray v1 bytes sees empty
  containers rather than garbage — but don't mix them; wipe.)
- Pre-v2 accounts, local databases, and server op logs are simply discarded
  and re-created.

### Inbox rename (`main` → `inbox`) — a v2-internal cutover

Renaming the reserved list's stored id from `main` to `inbox` is a **stored-data
change, not additive**: the reserved literal appears in every reserved-list
item's `location` register and in the order-container name (`order/main` →
`order/inbox`). The container *shapes* are unchanged (only the reserved literal
and the `order/*` name differ), so **no schema-version renumber** — it stays v2 —
but it rides the same one-time **export → wipe → import** cutover as the v1→v2
break above, run once on the live doc at a clean checkpoint.

The **JSON importer aliases the legacy reserved id `main` ⇒ `inbox`** for the
reserved list only: exported JSON carries `list_id: "main"` for reserved-list
items, and the new build reserves `inbox`. This keeps the cutover a pure data
round-trip (no `sed` on the export file). `main` is stored verbatim in exported
JSON *only* as the reserved list's id — the alias is the only translation needed.

### Focus container — additive within v2

The `focus` container (`spec/focus.md`) is **additive within schema v2**: it
reinterprets no existing container, and Loro roots are typed by `(name, type)`,
so a focus-unaware v2 client simply never projects it. No version bump; the
sqlite migration (`001_init.sql`) is unaffected (opaque blobs).
