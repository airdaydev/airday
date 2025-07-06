import { SyncClient } from "../client/sync";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import type { AirdayItem } from "./model";
import { AirdayWALEntry, type WALTx } from "../storage/wal";
import type { SerialisedLWWRegister } from "../crdt/lww";
import { Builder } from "flatbuffers";
import { AddItemAction } from "../air-fb/add-item-action";
import { v4, parse } from "uuid";
import { AirdayMessage } from "../air-fb/airday-message";
import { AirdayAction } from "../air-fb/airday-action";
import { AirdayBatchComponent } from "../air-fb/airday-batch-component";

export interface SerialisedAirdayItem {
  id: string;
  text: SerialisedLWWRegister<string>;
}

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
    const actionId = v4();
    const builder = new Builder(1024);
    const itemOffset = item.toFlatBuffer(builder);
    const actionOffset = AddItemAction.createAddItemAction(builder, itemOffset);
    const batchOffset = AirdayBatchComponent.createAirdayBatchComponent(
      builder,
      AirdayAction.AddItemAction,
      actionOffset,
    );
    AirdayMessage.startAirdayMessage(builder);
    const idOffset = AirdayMessage.createIdVector(builder, parse(actionId));
    AirdayMessage.addId(builder, idOffset);
    AirdayMessage.addBatch(builder, batchOffset);
    AirdayMessage.endAirdayMessage(builder);
    const actionFB = builder.asUint8Array();
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
