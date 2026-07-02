// Reactive shell around the wasm `SyncEngine`. Doc state lives in a
// SolidJS `createStore` keyed by id; mutations go through the engine,
// which emits domain-level `AppEvent`s that this layer mirrors into the
// store via surgical `setState` calls. The store is the single source
// of truth the UI reads from — `state.listLive[listId]` for a list
// view's iteration order, `state.itemsById[id]` for content. Solid's
// proxy tracks each property path independently, so a peer editing one
// item doesn't invalidate the iteration and vice versa.
//
// There is deliberately no global item order: each mutation touches
// only the affected list's live array (splice at the event's
// `liveIndex`) plus maintained counters, so dispatch cost scales with
// the touched list, never with total items in the doc. Done/Bin views
// derive lazily from `itemsById` (timestamp sorts), not CRDT order.
// See spec/list-perf-plan.md.

import type { AppEventJs, SyncEngine } from "@airday/core/wasm";
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
  createdAt: number;
  doneAt?: number;
  binnedAt?: number;
}

export const isDone = (it: ItemView): boolean => it.doneAt != null;
export const isBinned = (it: ItemView): boolean => it.binnedAt != null;
/** Visible in a per-list view: not done, not binned. */
export const isInListView = (it: ItemView): boolean =>
  !isDone(it) && !isBinned(it);

export interface ListView {
  id: string;
  name: string;
  createdAt: number;
}

export interface WorkspaceState {
  itemsById: Record<string, ItemView>;
  /** Per-list live order — mirrors the core's `live_by_list`
   *  projection of Loro's MovableList. Done/binned items never appear
   *  here; a list with no live items may be absent or hold `[]`. */
  listLive: Record<string, string[]>;
  /** Binned-item count, maintained incrementally so the Bin badge
   *  never needs a global scan. */
  binCount: number;
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
  /** Live index the item occupied just before leaving the projection. */
  index: number;
  doneAt: number;
}

export interface SettingsView {
  /** When true, the nav renders the live-item count beside each
   *  non-Queue list (subject to the count > 0 gate). Queue's count is
   *  always shown regardless. Single global flag; default false. Synced
   *  via the doc-level settings map. */
  showListCounts: boolean;
  /** User-chosen display-name override for the reserved `main` (Queue)
   *  list. `null` when no override is set — clients fall back to the
   *  localized built-in label. Synced via the doc-level settings map. */
  mainName: string | null;
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
  /** Set or clear an item's done flag. Independent of binned. */
  setDone(id: string, done: boolean): void;
  setDoneMany(ids: string[], done: boolean): void;
  /** Set or clear an item's binned flag. Independent of done — binning a
   *  done item keeps it done; restoring keeps the done state alone. */
  setBinned(id: string, binned: boolean): void;
  setBinnedMany(ids: string[], binned: boolean): void;
  moveItem(id: string, listId: string, indexInList: number): void;
  deleteBinned(id: string): void;
  deleteBinnedMany(ids: string[]): void;
  emptyBin(): number;
  addList(name: string): string;
  renameList(id: string, name: string): void;
  moveList(id: string, index: number): void;
  deleteList(id: string): void;
  /** Toggle the global "show counts on non-Queue lists" setting.
   *  Queue's own count is always visible (subject to count > 0) and is
   *  not gated by this flag. */
  setShowListCounts(show: boolean): void;
  /** Set or clear the user-chosen display name for the reserved
   *  `main` (Queue) list. Passing `""` clears the override. */
  setMainName(name: string): void;
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
  "itemMoved",
  "itemRemoved",
  "itemStatusChanged",
  "itemListChanged",
]);

function materializeState(events: readonly AppEventJs[]): WorkspaceState {
  const itemsById: Record<string, ItemView> = {};
  const listLive: Record<string, string[]> = {};
  let binCount = 0;
  const listsOrder: string[] = [];
  const listsById: Record<string, ListView> = {};
  const settings: SettingsView = {
    showListCounts: true,
    mainName: null,
  };

  for (const ev of events) {
    switch (ev.kind) {
      case "settingsChanged": {
        settings.showListCounts = ev.showListCounts ?? true;
        settings.mainName = ev.mainName ?? null;
        break;
      }
      case "itemAdded": {
        const item: ItemView = {
          id: ev.id,
          listId: ev.listId ?? "",
          text: ev.text ?? "",
          notes: ev.notes ?? "",
          createdAt: Number(ev.createdAt ?? 0),
          doneAt: ev.doneAt != null ? Number(ev.doneAt) : undefined,
          binnedAt: ev.binnedAt != null ? Number(ev.binnedAt) : undefined,
        };
        itemsById[ev.id] = item;
        // The snapshot burst arrives in global CRDT order, so appending
        // live ids per list reproduces each list's live projection.
        if (isInListView(item)) {
          (listLive[item.listId] ??= []).push(ev.id);
        }
        if (isBinned(item)) binCount++;
        break;
      }
      case "listAdded": {
        listsById[ev.id] = {
          id: ev.id,
          name: ev.name ?? "",
          createdAt: Number(ev.createdAt ?? 0),
        };
        listsOrder.push(ev.id);
        break;
      }
    }
  }

  return {
    itemsById,
    listLive,
    binCount,
    listsOrder,
    listsById,
    settings,
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
    listLive: {},
    binCount: 0,
    listsOrder: [],
    listsById: {},
    settings: {
      showListCounts: true,
      mainName: null,
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

  // ---- listLive helpers: every write is list-local. `insertLive`
  // removes any existing occurrence first so re-dispatch of an id
  // (e.g. an add event for an item we already track) stays idempotent.
  const insertLive = (
    listId: string,
    id: string,
    index: number | undefined,
  ): void => {
    const cur = state.listLive[listId];
    const next = cur ? cur.filter((x) => x !== id) : [];
    next.splice(Math.min(index ?? next.length, next.length), 0, id);
    setState("listLive", listId, next);
  };
  const removeLive = (listId: string, id: string): void => {
    const cur = state.listLive[listId];
    if (!cur || !cur.includes(id)) return;
    setState(
      "listLive",
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
      case "itemAdded": {
        const prev = state.itemsById[ev.id];
        if (prev) {
          if (isInListView(prev)) removeLive(prev.listId, ev.id);
          if (isBinned(prev)) adjustBinCount(-1);
        }
        const item: ItemView = {
          id: ev.id,
          listId: ev.listId ?? "",
          text: ev.text ?? "",
          notes: ev.notes ?? "",
          createdAt: Number(ev.createdAt ?? 0),
          doneAt: ev.doneAt != null ? Number(ev.doneAt) : undefined,
          binnedAt: ev.binnedAt != null ? Number(ev.binnedAt) : undefined,
        };
        setState("itemsById", ev.id, item);
        if (isInListView(item)) insertLive(item.listId, ev.id, ev.liveIndex);
        if (isBinned(item)) adjustBinCount(1);
        break;
      }
      case "itemRemoved": {
        const prev = state.itemsById[ev.id];
        if (!prev) break;
        if (isInListView(prev)) removeLive(prev.listId, ev.id);
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
        // destination; done/binned items carry no liveIndex and their
        // view order is timestamp-derived, so there is nothing to do.
        const prev = state.itemsById[ev.id];
        if (!prev) break;
        if (isInListView(prev) && ev.liveIndex != null) {
          insertLive(prev.listId, ev.id, ev.liveIndex);
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
      case "itemStatusChanged": {
        const prev = state.itemsById[ev.id];
        if (!prev) break;
        const wasLive = isInListView(prev);
        const wasBinned = isBinned(prev);
        const doneAt = ev.doneAt != null ? Number(ev.doneAt) : undefined;
        const binnedAt = ev.binnedAt != null ? Number(ev.binnedAt) : undefined;
        const nowLive = doneAt == null && binnedAt == null;
        if (wasLive && doneAt != null && binnedAt == null) {
          // Leaving the live projection by being marked done: snapshot
          // the vacated position (before the removal below) for the
          // linger re-insert.
          const idx = state.listLive[prev.listId]?.indexOf(ev.id) ?? -1;
          captureRecentDone({
            id: ev.id,
            listId: prev.listId,
            index: idx >= 0 ? idx : 0,
            doneAt,
          });
        } else if (nowLive || binnedAt != null) {
          dropRecentDone(ev.id);
        }
        if (wasLive && !nowLive) removeLive(prev.listId, ev.id);
        if (!wasLive && nowLive) insertLive(prev.listId, ev.id, ev.liveIndex);
        setState("itemsById", ev.id, { doneAt, binnedAt });
        adjustBinCount((binnedAt != null ? 1 : 0) - (wasBinned ? 1 : 0));
        break;
      }
      case "itemListChanged": {
        const prev = state.itemsById[ev.id];
        if (!prev) break;
        // Status is untouched by this event — membership in the live
        // projection carries over, only the owning list changes.
        const live = isInListView(prev);
        if (live) removeLive(prev.listId, ev.id);
        setState("itemsById", ev.id, "listId", ev.listId ?? "");
        if (live) insertLive(ev.listId ?? "", ev.id, ev.liveIndex);
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
        // `itemListChanged` events), so the live array is empty by now
        // — drop the key so `listLive` doesn't accumulate dead lists.
        setState(
          "listLive",
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
      case "settingsChanged": {
        // Mirror the whole event payload — settings are tiny and the
        // wire format always sends the full known shape, so a single
        // setState keeps the store in lockstep with the doc.
        setState("settings", {
          showListCounts: ev.showListCounts ?? true,
          mainName: ev.mainName ?? null,
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
    // Batch so a multi-event drain (e.g. addItemsAt for a multi-line
    // paste, or a server frame applying many remote ops) shows up as
    // one reactive update — otherwise consumers like the dnd briefly
    // see the intermediate order and animate through it.
    batch(() => {
      if (coarse) {
        const snapshot = engine.snapshotEvents();
        const next = materializeState(snapshot);
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
      }
      if (events.length > 0) setVersion((v) => v + 1);
    });
  };

  // Materialize current doc state once. Same dispatcher as the live
  // path — no separate "load initial" code, no snapshot/diff.
  const initialSnapshot = engine.snapshotEvents();
  const initialState = materializeState(initialSnapshot);
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
    setMainName(name) {
      mutate(() => engine.setMainName(name));
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
