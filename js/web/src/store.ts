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

export type ItemStatus = "live" | "done" | "binned";

export interface ItemView {
  id: string;
  text: string;
  listId: string;
  status: ItemStatus;
  createdAt: number;
  doneAt?: number;
  binnedAt?: number;
}

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
  /** Clone a live item's text and place the copy directly after the
   *  original. Returns the new id, or null if the source is missing or
   *  not live. */
  duplicateItem(id: string): string | null;
  editItemText(id: string, text: string): void;
  setStatus(id: string, status: ItemStatus): void;
  moveItem(id: string, listId: string, indexInList: number): void;
  deleteBinned(id: string): void;
  emptyBin(): number;
  addList(name: string): string;
  renameList(id: string, name: string): void;
  moveList(id: string, index: number): void;
  deleteList(id: string): void;
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
          status: (ev.status as ItemStatus) ?? "live",
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
      case "itemStatusChanged": {
        if (state.itemsById[ev.id]) {
          setState("itemsById", ev.id, {
            status: (ev.status as ItemStatus) ?? "live",
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
    duplicateItem(id) {
      const orig = state.itemsById[id];
      if (!orig || orig.status !== "live") return null;
      let foundIdx = -1;
      let cursor = 0;
      for (const oid of state.itemsOrder) {
        const it = state.itemsById[oid];
        if (!it || it.listId !== orig.listId || it.status !== "live") continue;
        if (oid === id) {
          foundIdx = cursor;
          break;
        }
        cursor++;
      }
      if (foundIdx < 0) return null;
      const newId = engine.addItemAt(orig.listId, orig.text, foundIdx + 1);
      flush();
      return newId;
    },
    editItemText(id, text) {
      engine.editItemText(id, text);
      flush();
    },
    setStatus(id, status) {
      if (status === "live") engine.setItemLive(id);
      else if (status === "done") engine.setItemDone(id);
      else engine.binItem(id);
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
  };
}
