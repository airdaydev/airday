// Reactive shell around the wasm `SyncEngine`. Doc state lives in a
// SolidJS `createStore` keyed by id; mutations go through the engine,
// which emits domain-level `AppEvent`s that this layer mirrors into the
// store via surgical `setState` calls. The store is the single source
// of truth the UI reads from — `<For each={state.itemsOrder}>` for
// iteration, `state.itemsById[id]` for content. Solid's proxy tracks
// each property path independently, so a peer editing one item doesn't
// invalidate the iteration and vice versa.

import type { AppEventJs, SyncEngine } from "@airday/core/wasm";
import { batch, createSignal, type Accessor } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { createSearchEngine, type SearchEngine } from "./search.ts";

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
  /** When true, the nav renders this list's live-item count beside its
   *  name. Default false; toggled per-list from the nav context menu.
   *  Synced across devices. */
  showCountNav: boolean;
}

export interface WorkspaceState {
  /** Global item id order — mirrors Loro's MovableList; per-view
   *  filters derive from this. */
  itemsOrder: string[];
  itemsById: Record<string, ItemView>;
  listsOrder: string[];
  listsById: Record<string, ListView>;
  settings: SettingsView;
}

export interface SettingsView {
  /** When true, the nav renders the live-item count beside the
   *  reserved `main` (Home) list. Default false; synced across
   *  devices via the doc-level settings map. */
  mainShowCountNav: boolean;
  /** User-chosen display-name override for the reserved `main` (Home)
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
  /** Pump the engine's AppEvent queue into the store. The WS bridge
   *  calls this after every server frame; mutation methods call it
   *  inline so local writes flow through the same dispatcher path. */
  drainEvents(): void;
  /** Hook the WS bridge installs to push outbox bytes immediately
   *  after a local mutation rather than waiting for a server frame. */
  setOnFlush(cb: () => void): void;
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
  /** Toggle the nav-count badge for `id`. Refused for the reserved
   *  `main` (Home) list — that one has its own doc-level settings
   *  toggle. */
  setListShowCountNav(id: string, show: boolean): void;
  setMainShowCountNav(show: boolean): void;
  /** Set or clear the user-chosen display name for the reserved
   *  `main` (Home) list. Passing `""` clears the override. */
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
}

const COARSE_BATCH_THRESHOLD = 64;
const COARSE_EVENT_KINDS = new Set([
  "itemMoved",
  "itemRemoved",
  "itemStatusChanged",
  "itemListChanged",
]);

function materializeState(events: readonly AppEventJs[]): WorkspaceState {
  const itemsOrder: string[] = [];
  const itemsById: Record<string, ItemView> = {};
  const listsOrder: string[] = [];
  const listsById: Record<string, ListView> = {};
  const settings: SettingsView = {
    mainShowCountNav: false,
    mainName: null,
  };

  for (const ev of events) {
    switch (ev.kind) {
      case "settingsChanged": {
        settings.mainShowCountNav = ev.mainShowCountNav ?? false;
        settings.mainName = ev.mainName ?? null;
        break;
      }
      case "itemAdded": {
        itemsById[ev.id] = {
          id: ev.id,
          listId: ev.listId ?? "",
          text: ev.text ?? "",
          notes: ev.notes ?? "",
          createdAt: Number(ev.createdAt ?? 0),
          doneAt: ev.doneAt != null ? Number(ev.doneAt) : undefined,
          binnedAt: ev.binnedAt != null ? Number(ev.binnedAt) : undefined,
        };
        itemsOrder.push(ev.id);
        break;
      }
      case "listAdded": {
        listsById[ev.id] = {
          id: ev.id,
          name: ev.name ?? "",
          createdAt: Number(ev.createdAt ?? 0),
          showCountNav: ev.showCountNav ?? false,
        };
        listsOrder.push(ev.id);
        break;
      }
    }
  }

  return {
    itemsOrder,
    itemsById,
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
    itemsOrder: [],
    itemsById: {},
    listsOrder: [],
    listsById: {},
    settings: {
      mainShowCountNav: false,
      mainName: null,
    },
  });
  const [version, setVersion] = createSignal(0);
  const search = createSearchEngine();
  let actionBatchDepth = 0;
  let flushDeferred = false;
  let actionBatchStartVersion = 0;
  let pendingActionSteps = 0;
  const undoStack: number[] = [];
  const redoStack: number[] = [];

  const dispatch = (ev: AppEventJs): void => {
    switch (ev.kind) {
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
        setState("itemsById", ev.id, item);
        const targetIndex = ev.index ?? state.itemsOrder.length;
        setState(
          "itemsOrder",
          produce((order) => {
            const cur = order.indexOf(ev.id);
            if (cur >= 0) order.splice(cur, 1);
            const insertAt = Math.min(targetIndex, order.length);
            order.splice(insertAt, 0, ev.id);
          }),
        );
        break;
      }
      case "itemRemoved": {
        setState("itemsOrder", (o) => o.filter((id) => id !== ev.id));
        setState(
          "itemsById",
          produce((by) => {
            delete by[ev.id];
          }),
        );
        break;
      }
      case "itemMoved": {
        const target = ev.index ?? 0;
        setState(
          "itemsOrder",
          produce((order) => {
            const cur = order.indexOf(ev.id);
            if (cur < 0) return;
            order.splice(cur, 1);
            order.splice(Math.min(target, order.length), 0, ev.id);
          }),
        );
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
        if (state.itemsById[ev.id]) {
          setState("itemsById", ev.id, {
            doneAt: ev.doneAt != null ? Number(ev.doneAt) : undefined,
            binnedAt: ev.binnedAt != null ? Number(ev.binnedAt) : undefined,
          });
        }
        break;
      }
      case "itemListChanged": {
        if (state.itemsById[ev.id]) {
          setState("itemsById", ev.id, "listId", ev.listId ?? "");
        }
        break;
      }
      case "listAdded": {
        setState("listsById", ev.id, {
          id: ev.id,
          name: ev.name ?? "",
          createdAt: Number(ev.createdAt ?? 0),
          showCountNav: ev.showCountNav ?? false,
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
      case "listShowCountNavChanged": {
        if (state.listsById[ev.id]) {
          setState(
            "listsById",
            ev.id,
            "showCountNav",
            ev.showCountNav ?? false,
          );
        }
        break;
      }
      case "settingsChanged": {
        // Mirror the whole event payload — settings are tiny and the
        // wire format always sends the full known shape, so a single
        // setState keeps the store in lockstep with the doc.
        setState("settings", {
          mainShowCountNav: ev.mainShowCountNav ?? false,
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
  const flush = (): void => {
    if (actionBatchDepth > 0) {
      flushDeferred = true;
      return;
    }
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
    search,
    drainEvents,
    setOnFlush(cb) {
      onFlush = cb;
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
    moveList(id, index) {
      mutate(() => engine.moveList(id, index));
    },
    deleteList(id) {
      mutate(() => engine.deleteList(id));
    },
    setListShowCountNav(id, show) {
      mutate(() => engine.setListShowCountNav(id, show));
    },
    setMainShowCountNav(show) {
      mutate(() => engine.setMainShowCountNav(show));
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
