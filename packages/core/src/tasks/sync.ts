import { SyncClient } from "../client/sync";
import { AirdayIDB, type AirdayIDBPDatabase } from "../storage/idb";
import { AirdayItem, type AirdayItemFields } from "./model";
import { AirdayWALEntry, type WALTx } from "../storage/wal";
import {
  LWWRegister,
  LWWTimestamp,
  type LWW,
  type SerialisedLWWRegister,
} from "../crdt/lww";
import { Builder, ByteBuffer } from "flatbuffers";
import { AddItemAction as AddItemActionFB } from "../air-fb/add-item-action";
import { v4, parse } from "uuid";
import { AirdayMessage } from "../air-fb/airday-message";
import { AirdayAction } from "../air-fb/airday-action";
import { AirdayBatchComponent } from "../air-fb/airday-batch-component";
import { DeleteItemAction } from "../air-fb/delete-item-action";
import type { Item } from "../air-fb";

export interface SerialisedAirdayItem {
  id: string;
  text: SerialisedLWWRegister<string>;
}

class Action {
  id = v4();
}

export class GetListsActions extends Action {
  constructor(item: AirdayItem) {
    super();
  }
  addToFlatBuffer(build: Builder) {}
}

export function deserialiseAction(buffer: Uint8Array) {
  const bb = new ByteBuffer(buffer);
  const component = AirdayBatchComponent.getRootAsAirdayBatchComponent(bb);
  switch (component.actionType()) {
    case AirdayAction.AddItemAction: {
      const rObj = new AddItemActionFB();
      const addAction = component.action(rObj);
      const item = rObj.item(); // TODO: null vs non-existent
      if (!item) throw new Error("Item could not be found");
      return AddItemAction.fromItemFlatBuffer(item);
    }
    case AirdayAction.DeleteItemAction: {
      const rObj = new DeleteItemAction();
      const deleteAction = component.action(rObj);
      break;
    }
  }
}

export class AddItemAction extends Action {
  fields: Partial<AirdayItemFields> = {};
  constructor(fields: Partial<AirdayItemFields>) {
    super();
    this.fields = fields;
  }
  static fromItemFlatBuffer(item: Item) {
    const fields: Partial<AirdayItemFields> = {};
    const id = item.id();
    if (id) {
      fields.id = id;
    }
    const text = item.text();
    const textTimestamp = item.text()?.timestamp();
    if (text && textTimestamp) {
      // TODO: Make this its own function
      const timestamp = new LWWTimestamp({
        utc: textTimestamp.utc(),
        pid: textTimestamp.pid(),
        tick: textTimestamp.tick(),
      });
      fields.text = new LWWRegister({
        timestamp,
        data: text.value() || "",
      });
    }
    return new AddItemAction(fields);
  }
  static fromItem(item: AirdayItem) {
    const fields: Partial<AirdayItemFields> = {};
    fields.id = item.id;
    if (fields.text) fields.text = item.text;
    return new AddItemAction(fields);
  }
  static toFlatBuffer() {
    // TODO: Alternative would be to build Item from this!!!
    const itemOffset = item.toFlatBuffer(builder);
    const actionOffset = AddItemActionFB.createAddItemAction(
      builder,
      itemOffset,
    );
    const batchOffset = AirdayBatchComponent.createAirdayBatchComponent(
      builder,
      AirdayAction.AddItemAction,
      actionOffset,
    );
    AirdayMessage.startAirdayMessage(builder);
    const idOffset = AirdayMessage.createIdVector(builder, parse(this.id));
    AirdayMessage.addId(builder, idOffset); // necessity
    AirdayMessage.addBatch(builder, batchOffset);
    AirdayMessage.endAirdayMessage(builder);
    return builder.asUint8Array();
  }
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
