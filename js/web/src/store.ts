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
import { createStore, produce } from "solid-js/store";

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
  /** Global item id order — mirrors Loro's MovableList; per-view
   *  filters derive from this. */
  itemsOrder: string[];
  itemsById: Record<string, ItemView>;
  listsOrder: string[];
  listsById: Record<string, ListView>;
}

export interface DocApp {
  engine: SyncEngine;
  state: WorkspaceState;
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
  /** Set or clear an item's binned flag. Independent of done — binning a
   *  done item keeps it done; restoring keeps the done state alone. */
  setBinned(id: string, binned: boolean): void;
  moveItem(id: string, listId: string, indexInList: number): void;
  deleteBinned(id: string): void;
  emptyBin(): number;
  addList(name: string): string;
  renameList(id: string, name: string): void;
  moveList(id: string, index: number): void;
  deleteList(id: string): void;
  /** Per-session local undo. Returns whether a step was applied so the
   *  caller can decide whether to `preventDefault()` the keybinding.
   *  Remote-applied ops are excluded by origin tag — see
   *  `spec/sync-protocol.md` "Commit origin tagging". */
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Bracket a JS-side bulk loop so its N per-call commits collapse
   *  to a single undo step. Returns whatever `fn` returns; closes the
   *  group in `finally` so a thrown mutation doesn't leak an open
   *  group. Do not nest — Loro errors if a group is opened twice. */
  withUndoGroup<T>(fn: () => T): T;
}

export function createSyncedApp(engine: SyncEngine): DocApp {
  const [state, setState] = createStore<WorkspaceState>({
    itemsOrder: [],
    itemsById: {},
    listsOrder: [],
    listsById: {},
  });
  const [version, setVersion] = createSignal(0);

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
    }
  };

  const drainEvents = (): void => {
    let dispatched = 0;
    // Batch so a multi-event drain (e.g. addItemsAt for a multi-line
    // paste, or a server frame applying many remote ops) shows up as
    // one reactive update — otherwise consumers like the dnd briefly
    // see the intermediate order and animate through it.
    batch(() => {
      while (true) {
        const ev = engine.popAppEvent();
        if (!ev) break;
        dispatch(ev);
        dispatched++;
      }
      if (dispatched > 0) setVersion((v) => v + 1);
    });
  };

  // Materialize current doc state once. Same dispatcher as the live
  // path — no separate "load initial" code, no snapshot/diff.
  for (const ev of engine.snapshotEvents()) {
    dispatch(ev);
  }

  let onFlush: () => void = () => {};
  const flush = (): void => {
    engine.flush();
    onFlush();
    // Local mutations enqueue AppEvents synchronously; pull them so
    // the next Solid tick sees the store update.
    drainEvents();
  };

  return {
    engine,
    state,
    version,
    drainEvents,
    setOnFlush(cb) {
      onFlush = cb;
    },
    getItem(id) {
      return state.itemsById[id];
    },
    addItem(listId, text) {
      const id = engine.addItem(listId, text);
      flush();
      return id;
    },
    addItemAt(listId, text, indexInList) {
      const id = engine.addItemAt(listId, text, indexInList);
      flush();
      return id;
    },
    addItemsAt(listId, texts, indexInList) {
      const ids = engine.addItemsAt(listId, texts, indexInList);
      flush();
      return ids;
    },
    editItemText(id, text) {
      engine.editItemText(id, text);
      flush();
    },
    editItemNotes(id, notes) {
      engine.editItemNotes(id, notes);
      flush();
    },
    setDone(id, done) {
      engine.setItemDone(id, done);
      flush();
    },
    setBinned(id, binned) {
      engine.setItemBinned(id, binned);
      flush();
    },
    moveItem(id, listId, indexInList) {
      engine.moveItem(id, listId, indexInList);
      flush();
    },
    deleteBinned(id) {
      engine.deleteBinned(id);
      flush();
    },
    emptyBin() {
      const removed = engine.emptyBin();
      if (removed > 0) flush();
      return removed;
    },
    addList(name) {
      const id = engine.addList(name);
      flush();
      return id;
    },
    renameList(id, name) {
      engine.renameList(id, name);
      flush();
    },
    moveList(id, index) {
      engine.moveList(id, index);
      flush();
    },
    deleteList(id) {
      engine.deleteList(id);
      flush();
    },
    undo() {
      const did = engine.undo();
      if (did) flush();
      return did;
    },
    redo() {
      const did = engine.redo();
      if (did) flush();
      return did;
    },
    canUndo() {
      return engine.canUndo();
    },
    canRedo() {
      return engine.canRedo();
    },
    withUndoGroup(fn) {
      engine.beginUndoGroup();
      try {
        return fn();
      } finally {
        engine.endUndoGroup();
      }
    },
  };
}
