import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AddItemAction, AirdayBatchMessage } from "./actions";
import { AirdayItem } from "./model";

// Creates & serialises actions to pass to mq
export class AirdaySync {
  private idb: AirdayIDB | null = null;
  private idbHandle: AirdayIDBPDatabase | null = null;
  private core: AirdayCore;
  constructor(core: AirdayCore) {
    this.core = core;
  }
  timestamp() {
    return globalTSProducer.timestamp();
  }
  // TODO: Use account
  setDB(idb: AirdayIDB) {
    this.idb = idb;
    this.idbHandle = idb.handle;
  }
  wrapAction() {}
  // TODO: Should this just be a general sync message with what items and since when!?
  // TODO: Also we should store this in our database
  async getLibraries() {}
  async getContainers() {}
  async getActiveItemsByLibrary() {}
  async getCompletedItemsByLibrary() {}
  async createList(list: any) {}
  // TODO: Pluralise this and we can call it when a list has been synced
  async createItem(item: AirdayItem) {
    const action = new AddItemAction(item);
    this.idb?.item.upsert([item]); // optimistic update
    const message = new AirdayBatchMessage([action]);
    this.core.mq.enqueueAirdayMessage(message);
    // TODO: So we need our sync core to subscribe to all item updates!
    // When the item is synced, we need to mark the live item as synced
    // TODO: test to ensure item is created server side before it is allowed an update (Notification via the item themself (on create, immediately update)!
  }
  async deleteItem(id: String) {}
}
