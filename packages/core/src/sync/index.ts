import type { AirdayCore } from "../core";
import { MessageQueue } from "../websocket/mq";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AirdayWALEntry } from "../storage/wal";
import { AddItemAction, createAirdayMessage } from "./actions";
import { AirdayItem } from "./model";

// Creates & serialises actions to pass to ws client
export class AirdaySync {
  private idb: AirdayIDB | null = null;
  private idbHandle: AirdayIDBPDatabase | null = null;
  private client: AirdayCore;
  constructor(client: AirdayCore) {
    this.client = client;
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
    this.client.mq.enqueueAirdayMessage(message);
    // TODO: So we need our sync client to subscribe to all item updates!
    // When the item is synced, we need to kill its WAL entry (and maybe mark the live item as synced)
    // We could do this ultra granular (callbacks) or just a one off (permanent subscription)
    // TODO: test to ensure item is created server side before client update!
    await tx.done;
  }
  async deleteItem(id: String) {}
}
