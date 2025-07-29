import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AddItemAction, AirdayBatchMessage } from "./actions";
import { AirdayItem, SyncState } from "./model";

// Creates & serialises actions to pass to mq
export class AirdaySync {
  private idb: AirdayIDB | null = null;
  private idbHandle: AirdayIDBPDatabase | null = null;
  private core: AirdayCore;
  constructor(core: AirdayCore) {
    this.core = core;
    // this.core.ws.events.on("ack", (message) => {
    //   message.messageId
    // });
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
    this.core.ws.enqueueAirdayMessage(message);
    // TODO: So we need our sync core to subscribe to all item updates!
    // When the item is synced, we need to mark the live item as synced
    // TODO: test to ensure item is created server side before it is allowed an update (Notification via the item themself (on create, immediately update)!
  }
  deleteItem(id: String) {}
}
