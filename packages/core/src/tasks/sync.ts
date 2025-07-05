import { SyncClient, type Action, type MessageWrapper } from "../client/sync";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import type { AirdayItem } from "./model";
import type { WALTx } from "../storage/wal";
import type { SerialisedLWWRegister } from "../crdt/lww";
import { Message } from "../air-fb";
import { Builder } from "flatbuffers";
import { MessageType } from "../air-fb/message-type";
import { AddItemAction } from "../air-fb/add-item-action";
import { MessageData } from "../air-fb/message-data";
import { v4 } from "uuid";
import { AirdayMessage } from "../air-fb/airday-message";
import { AirdayAction } from "../air-fb/airday-action";

export interface SerialisedAirdayItem {
  id: string;
  text: SerialisedLWWRegister<string>;
}

const enum actionTypes {
  addItem = "addItem",
  updateItem = "updateItem",
  deleteItem = "deleteItem",
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
  async createAirdayMessage() {
    const id = v4();
    const builder = new Builder(1024);
    AirdayMessage.createAirdayMessage(builder);
    return builder;
  }
  async createItem(item: AirdayItem) {
    const timestamp = Date.now();
    const builder = new Builder(1024);
    const itemOffset = item.toFlatBuffer(builder);
    const dataOffset = AddItemAction.createAddItemAction(builder, itemOffset);
    Message.startMessage(builder);
    Message.addType(builder, MessageType.Airday);
    Message.addData(builder, dataOffset);
    const messageOffset = Message.endMessage(builder);
    builder.finish(messageOffset);
    const fb = builder.asUint8Array();

    const msg: MessageWrapper = {
      timestamp,
      id: actionId,
      fb,
    };
    const tx = this.idb!.wal.writeTx(["item"], msg);
    tx.objectStore("item").add(item.toJSON());
    this.syncClient?.enqueueActions([msg]);
    // TODO: So we need our sync client to subscribe to all item updates!
    // When the item is synced, we need to kill its WAL entry (and maybe mark the live item as synced)
    // We could do this ultra granular (callbacks) or just a one off (permanent subscription)
    // TODO: test to ensure item is created server side before client update!
    await tx.done;
  }
}
