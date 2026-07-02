# Airday web-UI list-perf survey — handoff

> Working design/handoff doc (not a finalized contract). Companion to the
> "Performance note" in [`data-model.md`](data-model.md). Move/rename freely.

## Problem
On M1, lists feel sluggish to respond at ~5k+ items. Confirmed cause: **not DOM
re-render, not the CRDT op** — it's JS reactivity recomputing derived state O(N
over *all* items in the doc) on every mutation. Matches the note in
`data-model.md` ("global changes per move"; core move ~0.13ms but ~10 FPS → tens
of ms in JS).

## Confirmed seams (file:line)
Per single mutation (e.g. one move / status toggle), with N = total items in
doc, M = current-view length:

1. **Four global O(N) memos in `js/web/src/Workspace.tsx`**, all scanning the
   global `state.itemsOrder` (all lists + Done + Bin):
   - `items()` `Workspace.tsx:170-196` — maps N→new array; filter reads
     `listId/doneAt/binnedAt`, so any status change re-runs it.
   - `lingerChain()` `:130-151`
   - `liveCountsByList()` `:221-229`
   - `binCount()` `:207-214`
   - → Done/Bin items are dead weight in every list-view mutation (explains
     Done-heavy slowness).
2. **DnD cascade O(M)**, several times/mutation: `setDndItems` effect
   `Workspace.tsx:253` → `keyIndex` rebuild `dnd/solid/Dnd.tsx:96` →
   `source.syncOrder` `Dnd.tsx:234` → `selection.updateOrder`
   (`dnd/core/selection.ts:43`, full Map rebuild) → `getRenderState` calls
   `selection.updateOrder` **again** `dnd/core/dnd-controller.ts:294`.
3. **Scroll cost**: `onScroll`→`onChange`→`getRenderState`→`selection.updateOrder`
   rebuilds the full key→index Map **on every scroll event**, independent of
   mutations.

DOM is virtualized (`dnd-controller.ts:384-416`), so node count is bounded —
ruled out as the cause.

## Root cause
Web store keeps one global `itemsOrder` (`js/web/src/sync/store.ts:42`) and
re-derives every view + count from it each mutation. The core event contract
(`core/src/events.rs:18-20`) emits a **global** index and instructs UIs to
"track a single global order and filter per view."

## Key enabler (already exists in core)
`da4a631c` added `ItemIndex.live_by_list` in `core/src/doc.rs:218` — **per-list
live-order arrays** (Done/binned excluded). The projection exists in Rust but is
flattened back to global at the event boundary. Finishing the job = surfacing
per-list local index through events.

## Design direction
Goal: **no global-order evaluation on any mutation path**; only per-list arrays,
built once at boot.
- Global order is not fundamentally needed post-startup: list views =
  `live_by_list[L]` (CRDT order); Done/Bin = timestamp sort (`doneAt`/`binnedAt`
  desc), not CRDT order.
- Mandatory boot O(N) is `itemsById` + **search index** (`store.ts:407`) — a
  *content* pass, not an order pass. Build per-list arrays as a byproduct; drop
  the global `itemsOrder` array entirely.
- This removes the Done-weight problem **without** the risky second-doc split
  floated in the `data-model.md` note.

### Target store shape
```ts
interface WorkspaceState {
  itemsById: Record<string, ItemView>;
  listLive: Record<string, string[]>;       // per-list live order (the projection)
  liveCountsByList: Record<string, number>;  // maintained, not scanned
  binCount: number;                          // maintained, not scanned
  listsOrder: string[];
  listsById: Record<string, ListView>;
  settings: SettingsView;
  // no global itemsOrder
}
```
Dispatch becomes list-local (splice into one `listLive[listId]`, adjust
counters). Done/Bin computed lazily only while that view is active, memoized.

### Core change needed
Emit **per-list local live index** on `ItemAdded`/`ItemMoved`/`ItemListChanged`
(position within that list's live array), instead of/alongside global index.
Optionally expose `live_by_list` snapshot for boot.

## Recommended sequencing
**Phase 0 — cheap, no core change, measure after:**
1. Order-version guard on `selection.updateOrder` (`selection.ts:43`) → no-op
   when order unchanged; kills per-scroll rebuild + double-rebuild-per-mutation.
2. Incremental counters for `binCount`/`liveCountsByList` → drop the two global
   scans.

**Phase 1 — real fix:** per-list `listLive` arrays + per-list index in events;
drop `itemsOrder`; lazy Done/Bin.

## Residual ceiling (defer)
Intra-list add/move is still O(M_list) store splice (cheap pointer memmove; the
list you're viewing). A pathological single 10k live list keeps one O(M) splice.
Truly sub-linear would need fractional indexing / order-statistic tree —
over-engineering for now.
