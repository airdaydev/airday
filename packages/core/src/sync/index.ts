import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AirdayWALEntry } from "../storage/wal";
import { AddItemAction, createAirdayMessage } from "./actions";
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
  async createList(list: any) {}
  // TODO: Pluralise this and we can call it when a list has been synced
  async createItem(item: AirdayItem) {
    const action = AddItemAction.fromItem(item);
    const walAction = action.toActionFlatBuffer();
    const tx = this.idb!.wal.writeTx(
      ["item"],
      AirdayWALEntry(action.id, walAction),
    );
    tx.objectStore("item").add(item.toJSON()); // optimistic update
    const message = createAirdayMessage([action]);
    this.core.mq.enqueueAirdayMessage(message);
    // TODO: So we need our sync core to subscribe to all item updates!
    // When the item is synced, we need to kill its WAL entry (and maybe mark the live item as synced)
    // We could do this ultra granular (callbacks) or just a one off (permanent subscription)
    // TODO: test to ensure item is created server side before core update!
    await tx.done;
  }
  async deleteItem(id: String) {}
}
