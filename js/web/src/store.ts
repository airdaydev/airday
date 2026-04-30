// Reactive shell around the wasm `SyncEngine`. Every mutation is a
// passthrough to the engine, with `engine.flush()` queued so a push
// happens as soon as we're idle. A monotonically increasing `version`
// signal drives memo invalidation; it ticks on local mutations *and*
// on remote `opsApplied` engine events.

import type { SyncEngine } from "@airday/core/wasm";
import { createSignal, type Accessor } from "solid-js";

export interface ItemView {
  id: string;
  text: string;
  listId: string;
  status: "live" | "done" | "binned";
  createdAt: number;
  doneAt?: number;
  binnedAt?: number;
}

export interface ListMetaView {
  id: string;
  name: string;
  createdAt: number;
}

export interface WorkspaceSnapshot {
  lists: ListMetaView[];
  itemsById: Record<string, ItemView>;
  liveIdsByList: Record<string, string[]>;
  doneIds: string[];
  binnedIds: string[];
}

export interface DocApp {
  engine: SyncEngine;
  version: Accessor<number>;
  /** Re-derive views from the wasm doc. Called by the WS pump on
   *  `opsApplied`; manual mutations bump it themselves. */
  tick(): void;
  /** Optional hook the WS bridge installs so local mutations can
   *  pump bytes onto the wire immediately, instead of waiting for
   *  the next inbound frame. */
  setOnFlush(cb: () => void): void;
  // Mutations
  addItem(listId: string, text: string): string;
  editItemText(id: string, text: string): void;
  setStatus(id: string, status: "live" | "done" | "binned"): void;
  moveItem(id: string, listId: string, index: number): void;
  emptyBin(): number;
  deleteBinned(id: string): void;
  addList(name: string): string;
  renameList(id: string, name: string): void;
  deleteList(id: string): void;
  // Reads
  allLists(): ListMetaView[];
  liveItemIds(listId: string): string[];
  doneItemIds(): string[];
  binnedItemIds(): string[];
  getItem(id: string): ItemView | undefined;
  snapshot(): WorkspaceSnapshot;
}

export function createSyncedApp(engine: SyncEngine): DocApp {
  const [version, setVersion] = createSignal(0);
  const tick = () => setVersion((v) => v + 1);
  let onFlush: () => void = () => {};
  const flush = () => {
    engine.flush();
    onFlush();
  };

  return {
    engine,
    version,
    tick,
    setOnFlush(cb) {
      onFlush = cb;
    },

    addItem(listId, text) {
      const id = engine.addItem(listId, text);
      tick();
      flush();
      return id;
    },
    editItemText(id, text) {
      engine.editItemText(id, text);
      tick();
      flush();
    },
    setStatus(id, status) {
      if (status === "live") engine.setItemLive(id);
      else if (status === "done") engine.setItemDone(id);
      else engine.binItem(id);
      tick();
      flush();
    },
    moveItem(id, listId, index) {
      engine.moveItem(id, listId, index);
      tick();
      flush();
    },
    emptyBin() {
      const removed = engine.emptyBin();
      if (removed > 0) {
        tick();
        flush();
      }
      return removed;
    },
    deleteBinned(id) {
      engine.deleteBinned(id);
      tick();
      flush();
    },
    addList(name) {
      const id = engine.addList(name);
      tick();
      flush();
      return id;
    },
    renameList(id, name) {
      engine.renameList(id, name);
      tick();
      flush();
    },
    deleteList(id) {
      engine.deleteList(id);
      tick();
      flush();
    },

    allLists() {
      version();
      return JSON.parse(engine.allListsJson()) as ListMetaView[];
    },
    liveItemIds(listId) {
      version();
      return engine.liveItemIds(listId);
    },
    doneItemIds() {
      version();
      return engine.doneItemIds();
    },
    binnedItemIds() {
      version();
      return engine.binnedItemIds();
    },
    getItem(id) {
      version();
      const json = engine.getItemJson(id);
      return json ? (JSON.parse(json) as ItemView) : undefined;
    },
    snapshot() {
      version();

      const lists = JSON.parse(engine.allListsJson()) as ListMetaView[];
      const liveIdsByList: Record<string, string[]> = {};
      const itemsById: Record<string, ItemView> = {};

      for (const list of lists) {
        const ids = engine.liveItemIds(list.id);
        liveIdsByList[list.id] = ids;
        for (const id of ids) {
          const json = engine.getItemJson(id);
          if (!json) continue;
          const item = JSON.parse(json) as ItemView;
          itemsById[item.id] = item;
        }
      }

      const doneIds = engine.doneItemIds();
      for (const id of doneIds) {
        const json = engine.getItemJson(id);
        if (!json) continue;
        const item = JSON.parse(json) as ItemView;
        itemsById[item.id] = item;
      }

      const binnedIds = engine.binnedItemIds();
      for (const id of binnedIds) {
        const json = engine.getItemJson(id);
        if (!json) continue;
        const item = JSON.parse(json) as ItemView;
        itemsById[item.id] = item;
      }

      return {
        lists,
        itemsById,
        liveIdsByList,
        doneIds,
        binnedIds,
      };
    },
  };
}
