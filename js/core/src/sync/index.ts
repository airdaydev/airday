import { EventEmitter } from "../common/events";
import type { Uuidv4 } from "../common/uuid";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AddItemAction, AirdayAction, AirdayBatchMessage } from "./actions";
import { ChecksumStore } from "./checksum";
import { AirdayItem } from "./model";

interface SyncEventMap {
  flushed: {};
}

// Creates & serialises actions to pass to mq
// TODO: Message retries (Exponential backoff + max attempts)
// TODO: Failure thresholds + offline!!!
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
    this.core.ws.events.on("ack", (ack) => {
      const action = this.pendingActions.get(ack.actionId.toHex());
      if (action instanceof AddItemAction) {
        action.item.endSync();
        // TODO: targeted change instead of blunt (pass in idb to endSync?)
        this.idb?.item.update([action.item]).catch((err) => {
          console.log(err);
        });
        this.pendingActions.delete(ack.actionId.toHex());
        if (this.pendingActions.size === 0) {
          this.events.emit("flushed", {});
        }
      }
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
  getItemSince(serverTimestamp: number, libraryId: Uuidv4) {
    this.syncing = true;
    // this.core.ws.enqueueAirdayMessage();
    // TODO: create request
    // Initially we'll get all items since last seen
    // once we're satisfied, we'll engage regular diffs
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
  createItems(items: AirdayItem[]) {
    const actions = items.map((item) => {
      item.startSync();
      const action = new AddItemAction(item);
      this.idb?.item.insert([item]); // optimistic update
      this.pendingActions.set(action.id.toHex(), action);
      return action;
    });
    const message = new AirdayBatchMessage(actions);
    this.core.ws.enqueueAirdayMessage(message);
    return actions;
  }
  deleteItem(id: String) {}
}
