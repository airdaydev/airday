import { EventEmitter } from "../common/events";
import type { Uuidv4 } from "../common/uuid";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { ItemSyncReqProto } from "../proto";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AckEvent } from "../websocket";
import {
  UpsertItemAction,
  AirdayAction,
  AirdayBatchMessage,
  ItemSyncReqAction,
} from "./actions";
import { ChecksumStore } from "./checksum";
import { AirdayItem, AirdayItemAttributes } from "./model";

interface SyncEventMap {
  flushed: {};
}

// TODO: Ack timeouts...?
// TODO: Failure thresholds + offline!!!
// TODO: Ensure we are doing one sync at a time
export class AirdaySync {
  private idb: AirdayIDB | null = null;
  private idbHandle: AirdayIDBPDatabase | null = null;
  private core: AirdayCore;
  pendingActions = new Map<string, AirdayAction>(); // string = hex type
  events = new EventEmitter<SyncEventMap>();
  itemChecksum = new ChecksumStore();
  syncing = false; // an initial or diff sync operation is in progress (TODO: expand)
  lastServerTimestamp: number | null = null;
  constructor(core: AirdayCore) {
    this.core = core;
    this.core.ws.events.on("ack", (ack) => this.handleAck(ack));
  }
  // Wait for pending acknowledgements
  flush() {
    return new Promise((resolve) => {
      if (this.pendingActions.size === 0) resolve(null);
      this.events.once("flushed", resolve);
    });
  }
  timestamp() {
    return globalTSProducer.timestamp();
  }
  // TODO: Use account
  setDB(idb: AirdayIDB) {
    this.idb = idb;
    this.idbHandle = idb.handle;
  }
  getItemSince(libraryId: Uuidv4, serverTimestamp: number | null) {
    this.syncing = true;
    const action = new ItemSyncReqAction(libraryId, serverTimestamp);
    const message = new AirdayBatchMessage([action]);
    this.core.ws.enqueueAirdayMessage(message);
  }
  getLibraries() {}
  getContainers() {}
  getActiveItemsByLibrary() {
    // TODO: We c/should prioritise active items first
  }
  getCompletedItemsByLibrary() {}
  createList(list: any) {}
  // TODO: Pluralise this and we can call it when a list has been synced
  // TODO: Error handling?
  upsertItems(items: AirdayItem[]) {
    // Filter out items currently in sync
    const actions = items
      .filter((item) => {
        return !item.syncStarted;
      })
      .map((item) => {
        item.startSync();
        const action = new UpsertItemAction(item);
        // TODO: Ensure this works for updated items too
        this.idb?.item.upsert([item]); // optimistic update
        this.pendingActions.set(action.id.toHex(), action);
        return action;
      });
    const message = new AirdayBatchMessage(actions);
    this.core.ws.enqueueAirdayMessage(message);
    return actions;
  }
  syncPendingItems() {
    // Collects pending items from database to sync on boot
  }
  deleteItem(id: String) {}
  handleAck(ack: AckEvent) {
    const action = this.pendingActions.get(ack.actionId.toHex());

    if (action instanceof UpsertItemAction) {
      // TODO: targeted change instead of blunt (pass in idb to endSync?)
      this.idb?.item.upsert([action.item]).catch((err) => {
        console.log(err);
      });
      this.pendingActions.delete(ack.actionId.toHex());
      action.item.endSync();
      console.log("umm bruh", action.item.isSynced());
      if (this.pendingActions.size === 0) {
        // Consider renaming: no pending acknowledgements remaining
        this.events.emit("flushed", {});
      }
      // If item has changes applied during sync, sync them
      if (!action.item.isSynced()) {
        this.upsertItems([action.item]);
      }
    }
    // TODO: More actions here?
  }
}
