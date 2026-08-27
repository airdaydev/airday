# Subtasks (exploration, not yet settled)

Status: **design exploration**. Nothing here is built. The purpose of this doc is
to pick a model, name the sharp edges, and answer the "which part is next"
question before any code is written. Sections marked *Open* are still up for
decision.

## Product shape

A subtask is a small step that belongs to one parent item: "Part 4" of
"Complete video series", "book flights" of "Trip to Perth". It is captured,
reordered and ticked off from inside the parent's task dialog, and it earns a
row of its own in the Done feed when completed, because finishing Part 4 is a
real thing that happened today.

Constraints we want to keep from the rest of the product:

- **Single tier.** Subtasks do not have subtasks. Same discipline as Focus: one
  level of structure, no outliner. (The model tolerates deeper nesting arriving
  via a concurrent merge, see "Concurrency"; the UI just never offers it.)
- **A subtask is an Item**, not a checklist line inside the parent. That is
  what makes the Done feed, timestamps, undo, search, deadlines and Focus work
  for free. A `LoroList` of strings inside the parent was considered and
  rejected: no `done_at`, no id to reference from Focus, whole-value edits.
- **Subtasks are hidden inside the parent everywhere except the Done feed**
  (and anywhere the user explicitly references one, e.g. Focus, search). A list
  with "Complete video series" shows one row, not eleven.

## Data model

### Location is typed: `{type}:{id}:{placement}`

Today `Location = "<list_id>:<placement_id>"` and `list_id` is `inbox` or a
`ListMeta.id`. The proposal re-encodes the register with an explicit container
type, and we take the pre-release wipe to do it (export carries `list_id` only
and the importer mints placements, so the encoding never appears in JSON; the
cutover is export on the old build, import on the new, exactly like
`main ⇒ inbox`):

```
Location   = "{type}:{id}:{placement_id}"        type ∈ list | item
             "list:inbox:<p>"  "list:<uuid>:<p>"  "item:<uuid>:<p>"
OrderEntry = "<item_id>:<placement_id>"          unchanged: entries are always items
container  = "order/{type}/{id}"                  order/list/inbox, order/item/<uuid>
FocusRef   = "<item_id>"                          unchanged (only ever an item)
```

A subtask is an item whose `location` has type `item`. The type is what
classifies the container: no map lookup, no "absence means list" default, one
parser shape (exactly three components, else unparseable), and `inbox` is just a
list with a reserved id rather than a special case in the encoding. A client
that predates this fails loudly on an unparseable register rather than quietly
filing the item under an unknown list. `:` still cannot appear in an id, and
the placement id remains the handshake between `location` and the order entry,
so the visibility rule, the fallback tail, and the placement-id conflict
resolution are untouched.

Sibling order lives in `order/item/<parent_item_id>`, a MovableList of
`OrderEntry` strings exactly like a list's order container. The projection is
already keyed by the raw container string (`ProjectionIndex.members` /
`raw_orders` in `core/src/doc.rs`), so once `Location::parse` yields a typed
container key, `resolved(container)` works unchanged for both.

Navigation: child ⇒ parent is `location.id` when `location.type == item`, one
`items` lookup. Parent ⇒ children is the existing reverse index
(`members[item:<parent_id>]`) plus `order/item/<parent_id>` for sibling order;
the parent map itself carries no child pointers.

Why this over a separate `parent` (or `subtask`) register beside `location`:

- **One membership mechanism.** `location` stays the single authoritative
  answer to "where does this item live", and the container type lives *inside*
  the one atomic register, so classification and container can never disagree.
  A sibling key would be a second LWW register that has to be kept in
  agreement by every mutation in every client forever; a Loro commit is atomic
  in application but conflicts between concurrent commits resolve per key.
- **Promote / demote are just `move_item`.** Demote = `move_item(id,
  item:<parent>, index)`; promote = `move_item(id, list:<list>, index)`. Fresh
  placement, atomic location write, entry delete + insert, one commit. No new
  mutation kinds.
- **Moving a parent between lists touches nothing else.** Children point at the
  parent, not at a list, so the parent's cross-list move is still one item's
  worth of writes.
- **"Subtask" is not a kind of item.** It is a task located under a task. A
  stored discriminator for genuinely different kinds (a note, say) is the
  reserved `item_type` field, orthogonal to containment.

**Export / import**: `ExportItem` keeps `list_id` for top-level items and gains
an optional `parent_id` for subtasks (mutually exclusive); the importer picks
the container from whichever is present and mints placements as today.
Children are exported in sibling order; the importer appends to
`order/item/<parent>` in file order (map inserts are order-independent, so
parents need not precede children).

`ItemView` grows two derived fields for client ergonomics: `parent_id: Option`
(the container id when it is an item) and `list_id` becomes the **effective
list** (walk up to the top-level ancestor and take its list). Clients never
resolve the chain themselves.

### Effective list and orphans

`effective_list(item)`: follow `location.id` while `location.type == item`
and it names an existing item, with a visited set and a small hop cap (8). The list reached is
the effective list. If the walk hits a **missing container** (parent hard
deleted concurrently), a **cycle**, or the cap, the item is **lost**, and lost
items project as top-level in `inbox`'s fallback tail, `(created_at, id)`
ordered, exactly like a list item with a missing order entry. Deterministic
across replicas, never hides data, never needs a write. `reconcile()` may
materialise a lost item into `inbox` with a real location (it already does the
analogous thing for missing entries).

Today an item whose location names an unknown list is silently grouped under a
container nobody projects. The "lost ⇒ inbox tail" rule is a strict improvement
and applies to that pre-existing case too.

### Lifecycle

Subtasks reuse `live` / `done_at` / `binned_at` unchanged. What each state
*means* for a subtask:

| State | Meaning for a subtask | Where it shows |
|---|---|---|
| Backlog | not started | parent's dialog |
| Live | **the one I'm on now** (see "Which part is next") | parent's dialog, highlighted |
| Done | finished | Done feed (global and per-list), parent's dialog (struck / collapsed) |
| Binned | discarded | Bin, with parent badge |

There is no board lane for subtasks; `live` on a subtask is a "current" marker,
not a lane.

**Coupling, parent ⇒ children.**

- **Parent Done ⇒ children untouched.** Decided: no cascade. A done parent
  with open children is a legal state; the children stay reachable through the
  parent's dialog (opened from the Done feed) and the parent's Done-feed row
  shows a `2 open` badge so unfinished parts do not vanish silently. Un-done is
  likewise a single-item write.
- **Parent Binned ⇒ every non-binned child Binned**, shared `binned_at`
  (mirrors delete-list, which bins a list's contents). **Restore parent ⇒
  children sharing that `binned_at` restore too.** Without this, binning a
  parent would leave open work visible nowhere but a binned item's dialog.
- **Parent hard-deleted (bin empty / delete-binned) ⇒ children hard-deleted.**
  They are only ever binned alongside the parent, so this is the natural
  reading.
- **Parent moves Backlog ⇔ Live: children untouched.**

**Coupling, children ⇒ parent: none.** Completing the last subtask does not
complete the parent. "Complete video series" may have work beyond the parts,
and auto-completing would surprise. The parent row shows `10/10` and the
dialog can offer a one-tap "Mark done" nudge; that is UI, not model.

Focus keeps its rules: Done removes the item's own focus refs and nothing
else's. A pinned child stays pinned when its parent is marked Done.

### Counts, fingerprint, search, export

- **Nav counts count top-level open items only.** A ten-part series is one
  thing on the list, not eleven. (`visible_counts` is per container already;
  the nav simply reads the list's container.)
- **`fingerprint()` hashes every `order/item/<item_id>` container** that has a
  living parent, same as list orders, in a deterministic (parent id) walk.
  Sibling order is logical state (it is the user's sequencing statement).
- **Search** indexes subtasks as documents with the parent's text appended as
  context; a hit opens the parent's dialog scrolled to the subtask.
- **JSON export / import**: see "Location is typed" above; the `main ⇒ inbox`
  alias is unaffected.
- **Deadlines** on subtasks are allowed (they are items). Any deadline surface
  renders them with a parent badge.

### Stored-data change within v2 (wipe, no bump)

The `location` re-encoding and the `order/{type}/{id}` container names are a
stored-data change, not additive: every existing location register and order
container name changes. It rides the same one-time export ⇒ wipe ⇒ import
cutover as `main ⇒ inbox` (`spec/data-model.md`). Container *shapes* are
unchanged, so no schema-version renumber; `001_init.sql` stores opaque blobs
and is unaffected.

## Concurrency

All of these resolve without a write and without divergence:

- **Demote vs move.** A demotes X under P; B moves X to list L. `location` is
  one LWW register, the loser's order entry goes stale. Existing rule.
- **Depth 2 from a merge.** A demotes X under Y; B demotes Y under Z. Merged:
  Z ⇒ Y ⇒ X. Effective list resolves through the chain. The UI renders X inside
  Y's dialog (a subtask's dialog can be opened; it simply hides the "add
  subtask" affordance). Nothing breaks, the user can promote to tidy.
- **Cycle from a merge.** A demotes X under Y; B demotes Y under X. Both are
  lost ⇒ inbox tail, top-level, with their sibling container ignored. Rare,
  loud, recoverable by dragging.
- **Bin cascade vs child edit.** A bins parent P (cascading child C); B
  concurrently un-bins or edits C. `binned_at` on C is LWW; C may end up open
  under a binned parent. Projection tolerates it (C is reachable via P's
  dialog from the bin); restore of P sweeps it up if it still shares the
  timestamp. No reconcile needed.
- **Parent hard-deleted vs child added.** Child becomes lost ⇒ inbox tail.

Mutation-time guards (local, not invariants): `move_item` refuses when the
target item is the moving item, is a descendant of it, or is itself a subtask
(depth 1 from the local view); `add_item(parent_id, ..)` refuses when
`parent_id` is a subtask.

## Which part is next

The question: "Complete video series" has Parts 1..10, some done, some not, in
what may be a non-contiguous pattern. Which is the next part?

Decided: the parent row shows nothing, so this only governs the dialog (which
child is highlighted as current) and any future surface that wants a single
"next". The definition is kept because it falls out of the model for free:

Rule: **next = first Live sibling in order, else first open sibling in order.**

- **Order is the sequencing statement.** The sortable list in the dialog *is*
  the plan, in the same way Focus order is. If Parts 1, 2 and 5 are done and 3
  and 4 are not, the plan says 3 is next, and showing "Part 3" is the honest
  answer: you skipped it. A hole is not ambiguity, it is information, and the
  `3/10` progress makes it visible.
- **Live is the explicit override.** "I'm actually on Part 6 now" is one tap in
  the dialog (mark Live). It survives holes, out-of-order completion, and
  reordering, and needs no new field. When the Live one is marked Done, the
  highlight falls back to first-open. Nothing auto-advances; the user
  re-states intent, which is the same discipline Focus asks for.
- Multiple Live siblings: first in order wins. No enforcement of "only one
  Live"; it is a display rule.

Rejected: *first open after the most recently completed sibling*. It reads
naturally for a strictly sequential series but depends on `done_at` clocks,
wraps around confusingly once the tail is exhausted, and gives a different
answer for the same list depending on which order two devices' clocks landed
in. The order-based rule gives the same answer on every replica from the
order container alone.

Rejected: a `next` pointer register on the parent. Extra state that has to be
maintained on every child transition, and it is exactly what `live` already
encodes.

## Surfaces

**Parent row** (flat list, Focus): **unchanged.** No next line, no count; a
parent renders exactly like any other item. Decided: anything in the row is
too messy. The subtask state is visible only when the item is opened.

**Board card**: a small radial progress glyph (done/total) in the footer badge
group, nothing else.

**Task dialog**: a "Subtasks" section below the notes, rendered
with the same compact `<Dnd>` shape the nav uses for list reorder
(`js/web/src/nav.tsx:469`), one row per child in sibling order: checkbox,
inline-editable text, drag handle, context menu (Mark current / Promote to
list / Move to bin). **Done children are collapsed by default** into a single
`27 done` disclosure row at the bottom of the section (a 40-chapter book must
not present 40 rows); expanding it is local UI state, not synced and not
persisted per parent. Children ticked *during the current dialog session* stay
visible in place, struck, so the list does not jump under the cursor and an
un-tick is one tap; they fold into the disclosure the next time the dialog
opens. A capture input at the bottom; **multi-line paste creates
one subtask per line in one commit** (`add_items_at` already exists), which
covers "Part 1 .. Part 10". The section is hidden when there are no children;
an "Add subtask" affordance in the dialog's overflow menu (or a keystroke)
reveals it. Opening a subtask's own dialog is allowed (it is an item), with a
parent badge in the header that navigates up.

**Done feed** (global and per-list Done lane): subtasks appear as ordinary rows
sorted by `done_at`, with a parent badge (`↳ Complete video series`, the same
`badge` element as the origin-list badge) in the row's badge group. A done parent with open
children shows a `2 open` badge. One row per chapter read is the point; nothing
is folded.

**Bin**: subtasks render with a parent badge; restoring a child under a still
binned parent restores only the child (it becomes visible inside the binned
parent's dialog, which is reachable from the bin). Decided: allowed.

**Focus**: a subtask can be pinned individually and renders with a parent
badge. A pinned parent renders as any other Focus row; opening it shows the
next step.

**Row context menu**: unchanged for now. The only way to add a subtask is
from inside the dialog. Drag-row-onto-row to demote is deferred.

**CLI**: `add --under <id>`, `ls <id>` (siblings), `mv <id> <parent|list>`.
`bin <id>` cascades like the web; `done <id>` does not.

## Core API delta

- `add_item*(container, ..)` accept a typed container (`item:<id>`) (guarded).
- `move_item(item_id, container, index)` accepts a typed `item:<id>` target
  (guarded).
- `set_items_lifecycle` unchanged; the Binned / restore transitions on a
  parent expand the id set per the coupling table before the single commit
  (Done does not).
- `ItemView { parent_id, list_id: effective }`, plus `children(item_id) ->
  Vec<ItemId>` (resolved sibling order, all lifecycles) and a cheap
  `child_summary(item_id) -> { open, done, next: Option<ItemId> }` for rows.
- Events: `ItemMoved` / `ItemListChanged` carry the typed container; the JS
  store derives `parentId` / `listId` from it. A `FullResync` is not required.
- `reconcile()` iterates `order/item/<item_id>` containers for every item that is
  a container, and relocates lost items to `inbox`.

## Decisions taken

- No Done cascade (parent Done leaves children as they are); Bin does cascade.
- No auto-complete of the parent on last child Done; a nudge in the dialog.
- Subtasks section sits below the notes in the dialog.
- Parent rows are unchanged (no next line, no count); board cards get only a
  small radial progress glyph (done/total) in the footer.
- Row context menu unchanged for now; subtasks are added only from the dialog.
- Restoring a child under a still-binned parent is allowed; it restores only
  the child.
- Strictly one level in the UI; the model tolerates more.
- FocusRef stays a bare `<item_id>`: Focus only ever points at items, and the
  first slot is reserved for the future cross-doc `<doc_id>:<item_id>` form.
