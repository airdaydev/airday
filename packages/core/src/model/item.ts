import { SyncClient, type Action } from "../client/sync";
import type { LWW, LWWRegister, SerialisedLWWRegister } from "../crdt/lww";
import type { AirdayIDB, AirdayIDBPDatabase } from "../storage/idb";
import type { WALTx } from "../storage/wal";

interface AirdayItemParams {
  id: string;
  text: LWWRegister<string>;
}

export interface SerialisedAirdayItem {
  id: string;
  text: SerialisedLWWRegister<string>;
}

export class AirdayItem {
  id: string;
  text: LWWRegister<string>;
  constructor(params: AirdayItemParams) {
    this.id = params.id;
    this.text = params.text;
  }
  merge(fields: Partial<Omit<AirdayItemParams, "id">>) {
    // TODO: If a server came back with a greater timestamp...
    const updatePayloads = [];
    if (fields.text) {
      const text = this.text.merge(fields.text);
      if (text !== this.text) {
        // Something like this
        updatePayloads.push(["text", fields.text]);
      }
    }
    return updatePayloads;
  }
  toJSON() {
    return {
      id: this.id,
      text: this.text.toJSON(),
    };
  }
}

const enum actionTypes {
  addItem = "addItem",
  updateItem = "updateItem",
  deleteItem = "deleteItem",
}

interface AddItemAction extends Action {
  type: actionTypes.addItem;
  payload: SerialisedAirdayItem;
}

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
  async createItem(item: AirdayItem) {
    const action: AddItemAction = {
      state: "pending", // TODO: Omit state in WAL?
      type: actionTypes.addItem,
      payload: item.toJSON(),
    };
    const tx = this.idb!.wal.writeTx(["item"], action);
    tx.objectStore("item").add(item.toJSON());
    this.syncClient?.enqueueActions([action]);
    // TODO: So we need our sync client to subscribe to all item updates!
    // When the item is synced, we need to kill its WAL entry (and maybe mark the live item as synced)
    // We could do this ultra granular (callbacks) or just a one off (permanent subscription)
    // TODO: test to ensure item is created server side before client update!
    await tx.done;
  }
}
