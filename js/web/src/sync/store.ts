// Reactive shell around the wasm `SyncEngine`. Doc state lives in a
// SolidJS `createStore` keyed by id; mutations go through the engine,
// which emits domain-level `AppEvent`s that this layer mirrors into the
// store via surgical `setState` calls. The store is the single source
// of truth the UI reads from — `state.listOpen[listId]` for a list
// view's iteration order, `state.itemsById[id]` for content. Solid's
// proxy tracks each property path independently, so a peer editing one
// item doesn't invalidate the iteration and vice versa.
//
// There is deliberately no global item order: each mutation touches
// only the affected list's Open array (splice at the event's
// `openIndex`) plus maintained counters, so dispatch cost scales with
// the touched list, never with total items in the doc. Done/Bin views
// derive lazily from `itemsById` (timestamp sorts), not CRDT order.
// See spec/list-perf-plan.md.

import type { AppEventJs, SyncEngine } from "@airday/core/wasm";
import { ItemLifecycle } from "@airday/core/wasm";
import { batch, createSignal, type Accessor } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { createSearchEngine, type SearchEngine } from "../search.ts";

/** Done and binned are independent flags — an item can be both. The
 *  presence of the timestamp *is* the flag; there's no separate
 *  boolean. Helpers below derive predicates without recomputing. */
export interface ItemView {
  id: string;
  text: string;
  notes: string;
  listId: string;
  /** Lifecycle flag (`spec/data-model.md`): `true` ≡ Live, `false` ≡
   *  Backlog underneath any done/binned mask. The board's Backlog/Live
   *  lanes partition a list's Open items by this flag. */
  live: boolean;
  /** Optional date-only due date as a raw `YYYY-MM-DD` string (floating
   *  local calendar date — never parse it with `new Date("YYYY-MM-DD")`,
   *  which reads as UTC midnight). Absent means no due date. */
  dueOn?: string;
  createdAt: number;
  doneAt?: number;
  binnedAt?: number;
}

/** Derived four-state lifecycle (`spec/data-model.md`). */
export type Lifecycle = "backlog" | "live" | "done" | "binned";

/** Map the JS lifecycle string onto the wasm `ItemLifecycle` enum the
 *  engine's `setItemLifecycle` / `setItemsLifecycle` expect. */
function lifecycleEnum(l: Lifecycle): ItemLifecycle {
  switch (l) {
    case "backlog":
      return ItemLifecycle.Backlog;
    case "live":
      return ItemLifecycle.Live;
    case "done":
      return ItemLifecycle.Done;
    case "binned":
      return ItemLifecycle.Binned;
  }
}

export const isDone = (it: ItemView): boolean => it.doneAt != null;
export const isBinned = (it: ItemView): boolean => it.binnedAt != null;
/** Open (Backlog + Live): not done, not binned — the per-list view. */
export const isOpen = (it: ItemView): boolean =>
  !isDone(it) && !isBinned(it);
/** In the board's Live lane: open and flagged live. */
export const isLive = (it: ItemView): boolean => isOpen(it) && it.live;
/** In the board's Backlog lane: open and not flagged live. */
export const isBacklog = (it: ItemView): boolean => isOpen(it) && !it.live;
/** Resolved lifecycle by precedence Binned > Done > Live > Backlog. */
export const lifecycleOf = (it: ItemView): Lifecycle =>
  isBinned(it) ? "binned" : isDone(it) ? "done" : it.live ? "live" : "backlog";

export interface ListView {
  id: string;
  name: string;
  /** User-chosen display icon (a literal emoji grapheme), or absent when
   *  unset — consumers render a built-in fallback glyph. */
  icon?: string;
  createdAt: number;
}

export interface WorkspaceState {
  itemsById: Record<string, ItemView>;
  /** Per-list Open order (Backlog + Live) — mirrors the core's `open`
   *  projection of the list's `order/<list-id>` container. Done/binned
   *  items never appear here; a list with no open items may be absent
   *  or hold `[]`. The board partitions this array by each item's
   *  `live` flag into the Backlog and Live lanes. */
  listOpen: Record<string, string[]>;
  /** Binned-item count, maintained incrementally so the Bin badge
   *  never needs a global scan. */
  binCount: number;
  /** Visible Focus refs in curated order (`engine.focusRefIds()` — Open,
   *  local, deduped). The Focus lens iterates this; each id resolves to
   *  `itemsById`. Re-derived wholesale per non-empty event drain, since a
   *  focus mutation *or* an item lifecycle change elsewhere can alter
   *  visibility. See spec/focus.md. */
  focusOrder: string[];
  listsOrder: string[];
  listsById: Record<string, ListView>;
  settings: SettingsView;
}

/** Snapshot of where an item sat in its list's live order at the
 *  moment it was marked done. Feeds the list-view "linger" affordance
 *  (`Workspace`), which briefly re-inserts recently-done rows at their
 *  old position — the live projection itself drops them instantly. */
export interface RecentDoneEntry {
  id: string;
  listId: string;
  /** Open index the item occupied just before leaving the projection. */
  index: number;
  doneAt: number;
}

export interface SettingsView {
  /** When true, the nav renders the live-item count beside each
   *  non-Inbox list (subject to the count > 0 gate). Inbox's count is
   *  always shown regardless. Single global flag; default false. Synced
   *  via the doc-level settings map. */
  showListCounts: boolean;
  /** User-chosen display-name override for the reserved `inbox` list.
   *  `null` when no override is set — clients fall back to the localized
   *  built-in label. Synced via the doc-level settings map. */
  inboxName: string | null;
}

export interface DocApp {
  engine: SyncEngine;
  state: WorkspaceState;
  /** Local plaintext search index over items + lists in the active
   *  account. Built once after initial materialization and maintained
   *  incrementally from the same AppEvent stream that drives the store.
   *  See `spec/search.md`. */
  search: SearchEngine;
  /** Bumps every time at least one event is dispatched (local or
   *  remote). The persistence layer reads this to debounce-save the
   *  doc. The UI doesn't read it — Solid's store gives it granular
   *  reactivity directly. */
  version: Accessor<number>;
  /** Rolling capture of items that just left a live list by being
   *  marked done (local or remote). Entries are dropped when the item
   *  is restored, binned, removed, or moved, and pruned by age; the
   *  linger UI applies its own (shorter) expiry window on top. */
  recentDone: Accessor<readonly RecentDoneEntry[]>;
  /** Pump the engine's AppEvent queue into the store. The WS bridge
   *  calls this after every server frame; mutation methods call it
   *  inline so local writes flow through the same dispatcher path. */
  drainEvents(): void;
  /** Hook the WS bridge installs to push outbox bytes immediately
   *  after a local mutation rather than waiting for a server frame. */
  setOnFlush(cb: () => void): void;
  /** Hook run *before* `engine.flush()` on every local commit. The web
   *  host wires `engine.captureLocalOps()` here so the just-committed
   *  mutation is a durable op-log row before `flush()` triggers the
   *  outbox-driven push (which reads `storage.outbox()`). Without this
   *  the push would see an empty outbox and fall back to the legacy
   *  `pending_export` path. */
  setBeforeFlush(cb: () => void): void;
  // Reads
  getItem(id: string): ItemView | undefined;
  // Mutations
  addItem(listId: string, text: string): string;
  /** Insert a single item at `indexInList` (per the live-item view of
   *  `listId`). Past-end indices append. Single Loro op — no
   *  intermediate "appended at end" state. */
  addItemAt(listId: string, text: string, indexInList: number): string;
  /** Bulk-insert `texts` as a contiguous run starting at
   *  `indexInList`. Single commit, single drain — peers and the local
   *  UI see one update, not N. */
  addItemsAt(listId: string, texts: string[], indexInList: number): string[];
  editItemText(id: string, text: string): void;
  /** Set the free-form notes string. Empty clears it; whitespace is
   *  preserved verbatim. */
  editItemNotes(id: string, notes: string): void;
  /** Set (`YYYY-MM-DD`) or clear (`null`) an item's date-only due date.
   *  The value is a floating local calendar date; a malformed string is
   *  rejected by the core. */
  setItemDueOn(id: string, dueOn: string | null): void;
  /** Set or clear an item's done flag. Independent of binned. */
  setDone(id: string, done: boolean): void;
  setDoneMany(ids: string[], done: boolean): void;
  /** Set or clear an item's binned flag. Independent of done — binning a
   *  done item keeps it done; restoring keeps the done state alone. */
  setBinned(id: string, binned: boolean): void;
  setBinnedMany(ids: string[], binned: boolean): void;
  /** Move one item to a lifecycle in a single commit — the board's
   *  lane-drop primitive (`spec/board.md`). A Backlog↔Live flip keeps
   *  the item in its list's Open order; Done/Binned remove it. */
  setLifecycle(id: string, lifecycle: Lifecycle): void;
  setLifecycleMany(ids: string[], lifecycle: Lifecycle): void;
  /** Board Live-lane capture: append a new item directly as Live. */
  addItemLive(listId: string, text: string): string;
  /** Board Live-lane capture at a position: insert a new Live item at
   *  `indexInList` in the list's Open projection (like `addItemAt`). */
  addItemLiveAt(listId: string, text: string, indexInList: number): string;
  moveItem(id: string, listId: string, indexInList: number): void;
  deleteBinned(id: string): void;
  deleteBinnedMany(ids: string[]): void;
  emptyBin(): number;
  addList(name: string): string;
  renameList(id: string, name: string): void;
  /** Set (`icon` = emoji grapheme) or clear (`icon` = "") a list's
   *  display icon. */
  setListIcon(id: string, icon: string): void;
  moveList(id: string, index: number): void;
  deleteList(id: string): void;
  /** Toggle the global "show counts on non-Queue lists" setting.
   *  Queue's own count is always visible (subject to count > 0) and is
   *  not gated by this flag. */
  setShowListCounts(show: boolean): void;
  /** Set or clear the user-chosen display name for the reserved `inbox`
   *  list. Passing `""` clears the override. */
  setInboxName(name: string): void;
  /** Pin an item into the Focus lens at `index` in the visible curated
   *  order (default: append). No-op if the item already has a visible
   *  ref or isn't Open; throws if the item is unknown. See spec/focus.md. */
  addToFocus(id: string, index?: number): void;
  /** Batch add: pin each id into the Focus lens (appended in order) in a
   *  single commit. Unknown / not-Open / already-focused ids are skipped.
   *  Backs multi-select "add to focus". */
  addToFocusMany(ids: string[]): void;
  /** Remove an item's ref(s) from the Focus lens. The item is untouched. */
  removeFromFocus(id: string): void;
  /** Batch remove: drop each id's ref(s) from the Focus lens in one commit. */
  removeFromFocusMany(ids: string[]): void;
  /** Reorder an item within the Focus lens to visible position `index`. */
  moveInFocus(id: string, index: number): void;
  /** Per-session local undo. Returns whether a step was applied so the
   *  caller can decide whether to `preventDefault()` the keybinding.
   *  Remote-applied ops are excluded by origin tag — see
   *  `spec/sync-protocol.md` "Commit origin tagging". */
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  withActionBatch<T>(fn: () => T): T;
  /** Additive JSON import: lists in `json` are created as fresh user
   *  lists, items get fresh IDs and route into them (or local `main`).
   *  Single Loro commit → one undo step. */
  importJson(json: string): ImportSummary;
}

export interface ImportSummary {
  listsAdded: number;
  itemsAdded: number;
  itemsSkipped: number;
}

const COARSE_BATCH_THRESHOLD = 64;
const COARSE_EVENT_KINDS = new Set([
  "itemAdded",
  "itemMoved",
  "itemRemoved",
  "itemLifecycleChanged",
  "itemListChanged",
]);

interface WorkspaceSnapshotPayload {
  settings: SettingsView;
  lists: ListView[];
  /** `live` is omitted from the JSON when false (Backlog); normalize on
   *  read so `ItemView.live` is always a real boolean. */
  items: (Omit<ItemView, "live"> & { live?: boolean })[];
}

function materializeEngineSnapshot(engine: SyncEngine): WorkspaceState {
  const payload = JSON.parse(engine.workspaceSnapshotJson()) as WorkspaceSnapshotPayload;
  const itemsById: Record<string, ItemView> = {};
  const listOpen: Record<string, string[]> = {};
  let binCount = 0;
  for (const raw of payload.items) {
    const item: ItemView = { ...raw, live: raw.live ?? false };
    itemsById[item.id] = item;
    if (isOpen(item)) (listOpen[item.listId] ??= []).push(item.id);
    if (isBinned(item)) binCount++;
  }
  const listsById: Record<string, ListView> = {};
  for (const list of payload.lists) {
    listsById[list.id] = {
      id: list.id,
      name: list.name,
      icon: list.icon,
      createdAt: list.createdAt,
    };
  }
  return {
    itemsById,
    listOpen,
    binCount,
    // Not part of the workspace snapshot JSON (which is items + lists +
    // settings only) — read straight from the engine's focus projection.
    // Covers the coarse / fullResync reconcile path too, since both
    // rematerialize through here.
    focusOrder: engine.focusRefIds(),
    listsOrder: payload.lists.map((list) => list.id),
    listsById,
    settings: {
      showListCounts: payload.settings.showListCounts ?? true,
      inboxName: payload.settings.inboxName ?? null,
    },
  };
}

function shouldUseCoarseProjection(events: readonly AppEventJs[]): boolean {
  if (events.length < COARSE_BATCH_THRESHOLD) return false;
  let coarseCandidates = 0;
  for (const ev of events) {
    if (COARSE_EVENT_KINDS.has(ev.kind)) coarseCandidates++;
  }
  return coarseCandidates >= events.length / 2;
}

export function createSyncedApp(engine: SyncEngine): DocApp {
  const [state, setState] = createStore<WorkspaceState>({
    itemsById: {},
    listOpen: {},
    binCount: 0,
    focusOrder: [],
    listsOrder: [],
    listsById: {},
    settings: {
      showListCounts: true,
      inboxName: null,
    },
  });
  const [version, setVersion] = createSignal(0);
  const [recentDone, setRecentDone] = createSignal<readonly RecentDoneEntry[]>(
    [],
  );
  const search = createSearchEngine();
  let actionBatchDepth = 0;
  let flushDeferred = false;
  let actionBatchStartVersion = 0;
  let pendingActionSteps = 0;
  const undoStack: number[] = [];
  const redoStack: number[] = [];

  // ---- listOpen helpers: every write is list-local. `insertOpen`
  // removes any existing occurrence first so re-dispatch of an id
  // (e.g. an add event for an item we already track) stays idempotent.
  const insertOpen = (
    listId: string,
    id: string,
    index: number | undefined,
  ): void => {
    const cur = state.listOpen[listId];
    const next = cur ? cur.filter((x) => x !== id) : [];
    next.splice(Math.min(index ?? next.length, next.length), 0, id);
    setState("listOpen", listId, next);
  };
  const removeOpen = (listId: string, id: string): void => {
    const cur = state.listOpen[listId];
    if (!cur || !cur.includes(id)) return;
    setState(
      "listOpen",
      listId,
      cur.filter((x) => x !== id),
    );
  };
  const adjustBinCount = (delta: number): void => {
    if (delta !== 0) setState("binCount", (n) => n + delta);
  };

  // ---- recentDone (linger capture). Entries older than this are
  // unreachable by any linger chain (Workspace's window is shorter);
  // pruning on write keeps the array a handful of entries.
  const RECENT_DONE_TTL_MS = 15_000;
  const captureRecentDone = (entry: RecentDoneEntry): void => {
    setRecentDone((prev) => [
      ...prev.filter(
        (e) => e.id !== entry.id && entry.doneAt - e.doneAt < RECENT_DONE_TTL_MS,
      ),
      entry,
    ]);
  };
  const dropRecentDone = (id: string): void => {
    setRecentDone((prev) =>
      prev.some((e) => e.id === id) ? prev.filter((e) => e.id !== id) : prev,
    );
  };

  const dispatch = (ev: AppEventJs): void => {
    switch (ev.kind) {
      case "fullResync":
        // `drainEvents` handles this control event before dispatch.
        break;
      case "itemAdded": {
        const prev = state.itemsById[ev.id];
        if (prev) {
          if (isOpen(prev)) removeOpen(prev.listId, ev.id);
          if (isBinned(prev)) adjustBinCount(-1);
        }
        const item: ItemView = {
          id: ev.id,
          listId: ev.listId ?? "",
          text: ev.text ?? "",
          notes: ev.notes ?? "",
          live: ev.live ?? false,
          dueOn: ev.dueOn ?? undefined,
          createdAt: Number(ev.createdAt ?? 0),
          doneAt: ev.doneAt != null ? Number(ev.doneAt) : undefined,
          binnedAt: ev.binnedAt != null ? Number(ev.binnedAt) : undefined,
        };
        setState("itemsById", ev.id, item);
        if (isOpen(item)) insertOpen(item.listId, ev.id, ev.openIndex);
        if (isBinned(item)) adjustBinCount(1);
        break;
      }
      case "itemRemoved": {
        const prev = state.itemsById[ev.id];
        if (!prev) break;
        if (isOpen(prev)) removeOpen(prev.listId, ev.id);
        if (isBinned(prev)) adjustBinCount(-1);
        dropRecentDone(ev.id);
        setState(
          "itemsById",
          produce((by) => {
            delete by[ev.id];
          }),
        );
        break;
      }
      case "itemMoved": {
        // Pure reordering. Any list change arrived as the preceding
        // `itemListChanged`, so `prev.listId` is already the
        // destination; done/binned items carry no openIndex and their
        // view order is timestamp-derived, so there is nothing to do.
        const prev = state.itemsById[ev.id];
        if (!prev) break;
        if (isOpen(prev) && ev.openIndex != null) {
          insertOpen(prev.listId, ev.id, ev.openIndex);
        }
        break;
      }
      case "itemTextChanged": {
        if (state.itemsById[ev.id]) {
          setState("itemsById", ev.id, "text", ev.text ?? "");
        }
        break;
      }
      case "itemNotesChanged": {
        if (state.itemsById[ev.id]) {
          setState("itemsById", ev.id, "notes", ev.notes ?? "");
        }
        break;
      }
      case "itemLifecycleChanged": {
        const prev = state.itemsById[ev.id];
        if (!prev) break;
        const wasOpen = isOpen(prev);
        const wasBinned = isBinned(prev);
        const live = ev.live ?? prev.live;
        const doneAt = ev.doneAt != null ? Number(ev.doneAt) : undefined;
        const binnedAt = ev.binnedAt != null ? Number(ev.binnedAt) : undefined;
        const nowOpen = doneAt == null && binnedAt == null;
        if (wasOpen && doneAt != null && binnedAt == null) {
          // Leaving the Open projection by being marked done: snapshot
          // the vacated position (before the removal below) for the
          // linger re-insert.
          const idx = state.listOpen[prev.listId]?.indexOf(ev.id) ?? -1;
          captureRecentDone({
            id: ev.id,
            listId: prev.listId,
            index: idx >= 0 ? idx : 0,
            doneAt,
          });
        } else if (nowOpen || binnedAt != null) {
          dropRecentDone(ev.id);
        }
        // Only an open↔closed transition touches `listOpen`. A Backlog↔Live
        // flip (wasOpen && nowOpen) leaves the item in place — its lane is
        // recomputed from the updated `live` flag below.
        if (wasOpen && !nowOpen) removeOpen(prev.listId, ev.id);
        if (!wasOpen && nowOpen) insertOpen(prev.listId, ev.id, ev.openIndex);
        setState("itemsById", ev.id, { live, doneAt, binnedAt });
        adjustBinCount((binnedAt != null ? 1 : 0) - (wasBinned ? 1 : 0));
        break;
      }
      case "itemDueChanged": {
        if (state.itemsById[ev.id]) {
          setState("itemsById", ev.id, "dueOn", ev.dueOn ?? undefined);
        }
        break;
      }
      case "itemListChanged": {
        const prev = state.itemsById[ev.id];
        if (!prev) break;
        // Lifecycle is untouched by this event — membership in the Open
        // projection carries over, only the owning list changes.
        const open = isOpen(prev);
        if (open) removeOpen(prev.listId, ev.id);
        setState("itemsById", ev.id, "listId", ev.listId ?? "");
        if (open) insertOpen(ev.listId ?? "", ev.id, ev.openIndex);
        dropRecentDone(ev.id);
        break;
      }
      case "listAdded": {
        setState("listsById", ev.id, {
          id: ev.id,
          name: ev.name ?? "",
          createdAt: Number(ev.createdAt ?? 0),
        });
        const targetIndex = ev.index ?? state.listsOrder.length;
        setState(
          "listsOrder",
          produce((order) => {
            const cur = order.indexOf(ev.id);
            if (cur >= 0) order.splice(cur, 1);
            const insertAt = Math.min(targetIndex, order.length);
            order.splice(insertAt, 0, ev.id);
          }),
        );
        break;
      }
      case "listRemoved": {
        setState("listsOrder", (o) => o.filter((id) => id !== ev.id));
        setState(
          "listsById",
          produce((by) => {
            delete by[ev.id];
          }),
        );
        // Core reassigns the list's items to `main` (as preceding
        // `itemListChanged` events), so the Open array is empty by now
        // — drop the key so `listOpen` doesn't accumulate dead lists.
        setState(
          "listOpen",
          produce((by) => {
            delete by[ev.id];
          }),
        );
        break;
      }
      case "listMoved": {
        const target = ev.index ?? 0;
        setState(
          "listsOrder",
          produce((order) => {
            const cur = order.indexOf(ev.id);
            if (cur < 0) return;
            order.splice(cur, 1);
            order.splice(Math.min(target, order.length), 0, ev.id);
          }),
        );
        break;
      }
      case "listRenamed": {
        if (state.listsById[ev.id]) {
          setState("listsById", ev.id, "name", ev.name ?? "");
        }
        break;
      }
      case "listIconChanged": {
        if (state.listsById[ev.id]) {
          // `ev.icon` is undefined when the icon was removed — mirror
          // that so the nav falls back to the built-in glyph.
          setState("listsById", ev.id, "icon", ev.icon ?? undefined);
        }
        break;
      }
      case "settingsChanged": {
        // Mirror the whole event payload — settings are tiny and the
        // wire format always sends the full known shape, so a single
        // setState keeps the store in lockstep with the doc.
        setState("settings", {
          showListCounts: ev.showListCounts ?? true,
          inboxName: ev.inboxName ?? null,
        });
        break;
      }
    }
  };

  const drainEvents = (): void => {
    const events: AppEventJs[] = [];
    while (true) {
      const ev = engine.popAppEvent();
      if (!ev) break;
      events.push(ev);
    }
    const coarse = shouldUseCoarseProjection(events);
    const fullResync = events.some((ev) => ev.kind === "fullResync");
    // Batch so a multi-event drain (e.g. addItemsAt for a multi-line
    // paste, or a server frame applying many remote ops) shows up as
    // one reactive update — otherwise consumers like the dnd briefly
    // see the intermediate order and animate through it.
    batch(() => {
      if (fullResync || coarse) {
        const next = materializeEngineSnapshot(engine);
        setState(reconcile(next));
        // The bulk path skips per-event store dispatch, so let the
        // search engine do a wholesale rebuild from the fresh state
        // rather than try to track which events fell into the bucket.
        search.rebuild(next);
      } else {
        for (const ev of events) {
          dispatch(ev);
          search.apply(ev);
        }
        // Focus visibility depends on both focus-container mutations
        // (`focusChanged`) and item add/remove/lifecycle events elsewhere
        // (a Done/Bin drops a focused item from the view, and Done also
        // auto-removes its ref). One wholesale re-derive per non-empty
        // drain is the cheapest correct approach — `reconcile` no-ops when
        // the order is unchanged. See spec/focus.md B.8.
        if (events.length > 0) {
          setState("focusOrder", reconcile(engine.focusRefIds()));
        }
      }
      if (events.length > 0) setVersion((v) => v + 1);
    });
  };

  // Initial attach is explicit materialization, not a live event replay.
  // A single compact JSON snapshot crosses the wasm boundary and the
  // historical event queue remains empty.
  const initialState = materializeEngineSnapshot(engine);
  setState(reconcile(initialState));
  search.rebuild(initialState);

  let onFlush: () => void = () => {};
  let beforeFlush: () => void = () => {};
  const flush = (): void => {
    if (actionBatchDepth > 0) {
      flushDeferred = true;
      return;
    }
    beforeFlush();
    engine.flush();
    onFlush();
    // Local mutations enqueue AppEvents synchronously; pull them so
    // the next Solid tick sees the store update.
    drainEvents();
  };

  const recordAction = (steps: number): void => {
    if (steps <= 0) return;
    undoStack.push(steps);
    redoStack.length = 0;
  };

  const mutate = <T>(fn: () => T, assumedSteps = 1): T => {
    if (actionBatchDepth > 0) {
      pendingActionSteps += assumedSteps;
      const result = fn();
      flush();
      return result;
    }
    const before = version();
    const result = fn();
    flush();
    if (version() !== before) recordAction(assumedSteps);
    return result;
  };

  return {
    engine,
    state,
    version,
    recentDone,
    search,
    drainEvents,
    setOnFlush(cb) {
      onFlush = cb;
    },
    setBeforeFlush(cb) {
      beforeFlush = cb;
    },
    getItem(id) {
      return state.itemsById[id];
    },
    addItem(listId, text) {
      return mutate(() => engine.addItem(listId, text));
    },
    addItemAt(listId, text, indexInList) {
      return mutate(() => engine.addItemAt(listId, text, indexInList));
    },
    addItemsAt(listId, texts, indexInList) {
      return mutate(() => engine.addItemsAt(listId, texts, indexInList));
    },
    editItemText(id, text) {
      mutate(() => engine.editItemText(id, text));
    },
    editItemNotes(id, notes) {
      mutate(() => engine.editItemNotes(id, notes));
    },
    setItemDueOn(id, dueOn) {
      mutate(() => engine.setItemDueOn(id, dueOn ?? undefined));
    },
    setDone(id, done) {
      mutate(() => engine.setItemDone(id, done));
    },
    setDoneMany(ids, done) {
      mutate(() => engine.setItemsDone(ids, done));
    },
    setBinned(id, binned) {
      mutate(() => engine.setItemBinned(id, binned));
    },
    setBinnedMany(ids, binned) {
      mutate(() => engine.setItemsBinned(ids, binned));
    },
    setLifecycle(id, lifecycle) {
      mutate(() => engine.setItemLifecycle(id, lifecycleEnum(lifecycle)));
    },
    setLifecycleMany(ids, lifecycle) {
      mutate(() => engine.setItemsLifecycle(ids, lifecycleEnum(lifecycle)));
    },
    addItemLive(listId, text) {
      return mutate(() => engine.addItemLive(listId, text));
    },
    addItemLiveAt(listId, text, indexInList) {
      return mutate(() => engine.addItemLiveAt(listId, text, indexInList));
    },
    moveItem(id, listId, indexInList) {
      mutate(() => engine.moveItem(id, listId, indexInList));
    },
    deleteBinned(id) {
      mutate(() => engine.deleteBinned(id));
    },
    deleteBinnedMany(ids) {
      mutate(() => engine.deleteBinnedItems(ids));
    },
    emptyBin() {
      const before = version();
      const removed = engine.emptyBin();
      if (removed > 0) {
        flush();
        if (version() !== before) recordAction(1);
      }
      return removed;
    },
    addList(name) {
      return mutate(() => engine.addList(name));
    },
    renameList(id, name) {
      mutate(() => engine.renameList(id, name));
    },
    setListIcon(id, icon) {
      mutate(() => engine.setListIcon(id, icon));
    },
    importJson(json) {
      return mutate(() => {
        const summaryJson = engine.importJson(json);
        return JSON.parse(summaryJson) as ImportSummary;
      });
    },
    moveList(id, index) {
      mutate(() => engine.moveList(id, index));
    },
    deleteList(id) {
      mutate(() => engine.deleteList(id));
    },
    setShowListCounts(show) {
      mutate(() => engine.setShowListCounts(show));
    },
    setInboxName(name) {
      mutate(() => engine.setInboxName(name));
    },
    addToFocus(id, index) {
      // Default to the top: newly-focused items are "what am I working on
      // now" and belong at the head of the lens. An explicit index (e.g.
      // drag-to-reorder) still wins.
      mutate(() => engine.addToFocus(id, index ?? 0));
    },
    addToFocusMany(ids) {
      mutate(() => engine.addToFocusMany(ids));
    },
    removeFromFocus(id) {
      mutate(() => engine.removeFromFocus(id));
    },
    removeFromFocusMany(ids) {
      mutate(() => engine.removeFromFocusMany(ids));
    },
    moveInFocus(id, index) {
      mutate(() => engine.moveInFocus(id, index));
    },
    undo() {
      const steps = undoStack.pop();
      if (steps == null) return false;
      let applied = 0;
      for (let i = 0; i < steps; i++) {
        if (!engine.undo()) break;
        applied++;
      }
      if (applied === 0) {
        undoStack.push(steps);
        return false;
      }
      flush();
      redoStack.push(applied);
      return true;
    },
    redo() {
      const steps = redoStack.pop();
      if (steps == null) return false;
      let applied = 0;
      for (let i = 0; i < steps; i++) {
        if (!engine.redo()) break;
        applied++;
      }
      if (applied === 0) {
        redoStack.push(steps);
        return false;
      }
      flush();
      undoStack.push(applied);
      return true;
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
    withActionBatch(fn) {
      const outermost = actionBatchDepth === 0;
      actionBatchDepth++;
      if (outermost) {
        actionBatchStartVersion = version();
        pendingActionSteps = 0;
      }
      try {
        return fn();
      } finally {
        actionBatchDepth--;
        if (outermost) {
          if (flushDeferred) {
            flushDeferred = false;
            flush();
          }
          if (version() !== actionBatchStartVersion && pendingActionSteps > 0) {
            recordAction(pendingActionSteps);
          }
          pendingActionSteps = 0;
        }
      }
    },
  };
}
