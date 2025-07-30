import type { Uuidv4 } from "../uuid";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AddItemAction, AirdayAction, AirdayBatchMessage } from "./actions";
import { AirdayItem } from "./model";

// Creates & serialises actions to pass to mq
// TODO: Message retries (Exponential backoff + max attempts)
// TODO: Failure thresholds + offline!!!
export class AirdaySync {
  private idb: AirdayIDB | null = null;
  private idbHandle: AirdayIDBPDatabase | null = null;
  private core: AirdayCore;
  pendingActions = new Map<string, AirdayAction>(); // string = hex type
  constructor(core: AirdayCore) {
    this.core = core;
    this.core.ws.events.on("ack", (ack) => {
      console.debug("ack", ack);
      const action = this.pendingActions.get(ack.actionId.toHex());
      if (action instanceof AddItemAction) {
        action.item.endSync();
        // TODO: targeted change instead of blunt (pass in idb to endSync?)
        this.idb?.item.update([action.item]).catch((err) => {
          console.log(err);
        });
        this.pendingActions.delete(ack.actionId.toHex());
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
    item.startSync();
    const action = new AddItemAction(item);
    this.idb?.item.insert([item]); // optimistic update
    const message = new AirdayBatchMessage([action]);
    this.pendingActions.set(action.id.toHex(), action);
    this.core.ws.enqueueAirdayMessage(message);
    return action;
  }
  deleteItem(id: String) {}
}
