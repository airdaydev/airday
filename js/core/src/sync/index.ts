import type { Uuidv4 } from "../common";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AddItemAction, AirdayAction, AirdayBatchMessage } from "./actions";
import { AirdayItem, SyncState } from "./model";

// Creates & serialises actions to pass to mq
// TODO: Message retries (Exponential backoff + max attempts)
// TODO: Failure thresholds + offline!!!
export class AirdaySync {
  private idb: AirdayIDB | null = null;
  private idbHandle: AirdayIDBPDatabase | null = null;
  private core: AirdayCore;
  private pendingActions = new Map<Uuidv4, AirdayAction>();
  constructor(core: AirdayCore) {
    this.core = core;
    this.core.ws.events.on("ack", (ack) => {
      console.debug(`ack: ${ack}`);
      const action = this.pendingActions.get(ack.actionId);
      if (action) {
        action.ack(this.core);
        this.pendingActions.delete(ack.actionId);
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
  getLibraries() {}
  getContainers() {}
  getActiveItemsByLibrary() {}
  getCompletedItemsByLibrary() {}
  createList(list: any) {}
  // TODO: Pluralise this and we can call it when a list has been synced
  // TODO: Error handling?
  createItem(item: AirdayItem) {
    item.syncing = true;
    const action = new AddItemAction(item);
    this.idb?.item.upsert([item]); // optimistic update
    const message = new AirdayBatchMessage([action]);
    this.pendingActions.set(action.id, action);
    this.core.ws.enqueueAirdayMessage(message);
  }
  deleteItem(id: String) {}
}
