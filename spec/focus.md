# Focus (curated lens)

Focus is a reserved, single-tier, curated **list-by-reference**: it points at
items that live in other lists rather than owning them. It is a *lens*, not a
home — an item in Focus still lives in its source list, and removing it from
Focus removes only the *reference*, never the item.

Focus is deliberately minimal. It is the answer to "what am I actually working
on right now", drawn from across every list, in one hand-curated order.

## Product shape (settled decisions)

- **Single tier.** No "Next"/"Someday"/on-deck sub-tiers. The tool asks the user
  for discipline instead of inventing parking spots for indecision.
- **No scheduling, no dates.** "Do it first thing tomorrow" is a *sequencing*
  statement, not a time statement: drop the item into Focus now, ordered at the
  top, and it's there when you sit down. Deferring to a date is a separate,
  deliberately un-prominent future feature (hard-landscape items only), out of
  scope here.
- **A lens, not a home.** Acting on an item in Focus (mark Live/Done) mutates the
  item everywhere, because it *is* the same item.
- **Flat, not a board.** Focus renders as one ordered flat list of Open items.
  You can flip an item Live/Done from within it, but there are **no lanes** (no
  Backlog/Live/Done split, no board lens). Keeping it flat is the point.
- **Feels finite.** Focus is kept small by construction — single-tier, flat, and
  auto-compacting on Done — not by a cap or a nag. Focus that grows without bound
  is Focus that has stopped meaning anything. (An earlier soft-threshold colour
  nudge on the nav count was tried and dropped; the count renders plainly, like
  every other list.)

## Why Focus can't reuse the list/order machinery

An item's `location` register (`spec/data-model.md`) is a single atomic value
naming exactly **one** list, and an order container (`order/<list-id>`) only
becomes *visible* for an item when `item.location.list_id == L`. That is
single-membership by construction. Focus is a *second* appearance of an item
without moving it out of its home list, so it cannot ride on `location` or the
order-container visibility rule. Focus needs its own container of references.

There is no existing reference/alias/pointer concept in the doc model to extend —
`location` is the only membership mechanism — so Focus introduces one.

## Container

One reserved singleton container, analogous to `order/inbox`:

- `doc.get_movable_list("focus")` — a `LoroMovableList` of **encoded scalar
  FocusRef strings only** (never child containers — same discipline as order
  containers). The MovableList's own order *is* the Focus order; reorder via
  `MovableList::mov`.
- Not a `ListMeta` row (like `inbox`). Reserved, non-deletable, non-renamable.
- **Additive** to the schema-v2 layout — it reinterprets no existing container,
  and Loro roots are typed by `(name, type)`, so a focus-unaware client simply
  never projects it. No version bump. The sqlite migration (`001_init.sql`) is
  unaffected — it stores opaque blobs.

## FocusRef grammar (forward-compatible for cross-doc)

```
FocusRef = "<item_id>"              # now: local doc, bare uuid-v7 hex
         = "<doc_id>:<item_id>"     # future: cross-doc (sharing)
```

Same `:`-on-first-colon convention as `Location`/`OrderEntry`; uuid-hex
components (`[0-9a-f]{32}`) mean `:` never collides. **The parser accepts both
forms now** (no colon ⇒ local doc); **the emitter writes only the bare form**
until sharing lands. This is the whole point of designing it now — cross-doc refs
(`spec/sharing-plan.md`) slot in with zero migration. A ref whose `doc_id` is not
the local doc is *unresolvable today*; projection skips it (later: renders a
placeholder).

## Projection & visibility

`focus_view()` → ordered `Vec<ItemView>`:

```
visible(ref in focus) :=
     ref resolves to the local doc
  && items[ref.item_id] exists
  && items[ref.item_id] is Open           # done_at == null && binned_at == null
  && no earlier visible ref has the same item_id     # dedup, first wins
```

Refs to missing / done / binned / foreign-doc items are **harmless garbage** —
filtered out by projection. This mirrors the existing "stale order entries are
harmless" invariant. **Reads never mutate** (no self-repair on projection).

The Focus order is logical state (it fixes the curated order), exactly as each
list's resolved order is, so `doc_fingerprint` **hashes the focus order**.

## Lifecycle interplay — the key semantic decision

**Focus is finite by construction: completing an item removes it from Focus.**

Unlike an order container — where a Done item's entry still does work (it renders
in the board's Done lane) — a Done item is filtered out of the Focus view
entirely. A lingering Done ref in the focus container therefore renders *nothing*;
it is pure garbage. And `reconcile()` (the plan's nominal GC) is not wired to run
in production. So Focus cannot rely on lazy sweeping the way order containers do;
it compacts eagerly instead.

- **Done ⇒ the item's focus ref is removed in the same commit.** The Done
  transition (`set_item_lifecycle` → Done) additionally deletes the item's focus
  ref(s). Focus self-compacts; a completed item leaves Focus and does not come
  back on its own. Un-doing the item does **not** re-add it to Focus — you re-add
  deliberately (which is itself the discipline Focus is asking for). This is the
  single documented exception to "lifecycle transitions never touch a second
  container" (`spec/data-model.md`), justified because the focus ref is pure
  garbage once the item is Done, not live state like an order entry.
- **Binned ⇒ filtered out of the view** (Open filter), ref left in place. Binning
  is often bulk (delete-list bins many items) and frequently reversible, so it is
  *not* coupled to a focus write. The stale ref is swept the next time the user
  touches Focus (see below). Restoring a binned item before that sweep reveals it
  again in its former Focus position — an acceptable, low-volume nicety.
- **Hard delete ⇒ ref becomes garbage** (item lookup fails), swept on next focus
  interaction / reconcile.
- **Concurrency ⇒ residual garbage is harmless.** Device A adds a ref while device
  B (offline) marks the item Done; on merge the ref exists but points at a Done
  item. The Open filter hides it from the view immediately, and the sweep removes
  it on the next focus interaction. No divergence.

### Sweep on focus interaction

`add_to_focus` / `remove_from_focus` / `move_in_focus` each prune dead refs
(missing / binned / foreign / duplicate) from the focus container as part of
their single commit. Because these already write the focus container, the sweep
is a same-container, free ride — no extra commit, no coupling to unrelated
mutations. This keeps Focus bounded through ordinary use without depending on the
(unwired) global `reconcile()`.

`reconcile()` is *also* extended to prune focus dead refs and dedup, as an
idempotent backstop, but nothing depends on it running.

### Rejected: keep-and-filter only

Keeping the ref on Done and relying solely on `reconcile()` to sweep it (the
board's order-container discipline, transplanted) was rejected: `reconcile()`
doesn't run in production, so Focus would accumulate dead refs without bound —
and a Done ref, unlike a Done order entry, renders nothing, so there is no
positive reason to keep it. Auto-remove-on-Done trades the single-write invariant
(one conditional write to one singleton container) for genuine finiteness, which
is the product thesis.

## Core API surface (`core/src/doc.rs`)

New mutations (each **one Loro commit**):

- `add_to_focus(item_id, index)` — insert a FocusRef at `index` (default append).
  If the item already has a *visible* ref, **no-op** (do not move-to-top). Sweeps
  dead refs.
- `add_to_focus_many(item_ids)` — batch: append a FocusRef for each id, in the
  given order, in **one commit**. Ids that are unknown, not Open, already
  focused, or repeated within the batch are skipped (each a no-op — unlike the
  bulk lifecycle paths, an unknown id does not abort). Sweeps dead refs; emits at
  most one `FocusChanged`. Backs multi-select "add to focus".
- `remove_from_focus(item_id)` — remove the item's ref(s) from the focus
  container. Item untouched. Sweeps dead refs.
- `remove_from_focus_many(item_ids)` — batch remove of every listed id's ref(s)
  in **one commit**. Items untouched. Sweeps dead refs.
- `move_in_focus(item_id, index)` — reorder within Focus (`MovableList::mov`).
  Sweeps dead refs.

Reads:

- `focus_view()` / `focus_refs()` — the projection above. Pure.

Maintenance & integrity:

- `set_item_lifecycle` → Done removes the item's focus ref(s) in the same commit
  (see Lifecycle interplay).
- `reconcile()` prunes focus refs that are missing / done / binned / foreign, and
  dedups. Idempotent; no-op when clean.
- `doc_fingerprint` hashes the focus order.

Constant: `FOCUS_CONTAINER = "focus"`, alongside the existing container-name
constants.

## Events (`core/src/events.rs`)

A focus-changed event variant so clients re-project on focus mutations. A
lifecycle change that makes a focused item done/binned already emits an item
event — so the web store must re-derive `focus_view` on **item events too**
(visibility depends on item lifecycle), not only on focus-container events.

## Client (web) contract

- Focus is a static nav entry alongside Done and Bin (not a `ListMeta` row), with
  a fixed icon and a count badge = number of visible refs. Placed at the very top
  of the nav — above Inbox/Home and the user-created lists — as the first "what am
  I working on now" entry. The count renders plainly, like every other list count
  (no special colour treatment).
- The Focus view is a flat ordered list of `focus_view()`; drag-to-reorder reuses
  the existing DnD infrastructure. Per-row actions: toggle Live, mark Done, and
  **remove-from-focus as a single cheap gesture** (× / swipe). Removing must be as
  frictionless as adding — that's what keeps Focus lean.
- A pinned list row carries a **static, non-interactive "Focus" badge** when it
  has a visible focus ref, and nothing when it does not — a glanceable
  membership indicator, not a control. There is no per-row hover toggle.
- Adding / removing is driven entirely from the row **context menu**'s
  add/remove-focus entry, which acts on the whole multi-selection (or the row
  alone when it is not part of the selection), mirroring "Mark done" — it calls
  the batch `add_to_focus_many` / `remove_from_focus_many` so a selection is
  pinned/unpinned in one commit. Inside the Focus lens the row instead carries a
  cheap remove (×) gesture.

## Sync protocol

**No change.** Focus mutations are ordinary Loro ops in the same doc — opaque
blobs to the server. No wire-version bump, no server work.

## Future

Cross-doc Focus refs (`<doc_id>:<item_id>`) are the forward hook for sharing
(`spec/sharing-plan.md`): a shared item can be pulled into your Focus without
copying it. The grammar and parser already accept the form; only the emitter and
a foreign-ref placeholder renderer remain. Scheduling / deferred-to-a-date items
are a separate future feature and deliberately out of scope here.
