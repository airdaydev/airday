import { SyncClient } from "../client/sync";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AirdayItem } from "./model";

// Creates & serialises actions to pass to ws client
export class AirdayItemSync {
  private idb: AirdayIDB | null = null;
  private idbHandle: AirdayIDBPDatabase | null = null;
  private syncClient: SyncClient | null = null;
  constructor(syncClient: SyncClient) {
    this.syncClient = syncClient;
  }
  // TODO: Use account
  setDB(idb: AirdayIDB) {
    this.idb = idb;
    this.idbHandle = idb.handle;
  }
  wrapAction() {}
  async createItem(item: AirdayItem) {
    const tx = this.idb!.wal.writeTx(
      ["item"],
      AirdayWALEntry(actionId, actionFB),
    ); // store action in WAL
    tx.objectStore("item").add(item.toJSON()); // optimistic update
    this.syncClient?.enqueueAirdayAction(actionFB);
    // TODO: So we need our sync client to subscribe to all item updates!
    // When the item is synced, we need to kill its WAL entry (and maybe mark the live item as synced)
    // We could do this ultra granular (callbacks) or just a one off (permanent subscription)
    // TODO: test to ensure item is created server side before client update!
    await tx.done;
  }
  async deleteItem(id: String) {}
}
