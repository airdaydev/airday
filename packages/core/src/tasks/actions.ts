import { AirdayItem, type AirdayItemFields } from "./model";
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
import { Item, LWWRegisterString } from "../air-fb";
import { UUID } from "../air-fb/uuid";

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

function getUuidBytes(id: UUID) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    let byte = id.bytes(i);
    if (byte === null) throw new Error("UUID failed to parse from flatbuffer");
    bytes[i] = byte;
  }
  return bytes;
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
      fields.id = getUuidBytes(id);
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
  addToFlatBuffer(builder: Builder) {
    Item.startItem(builder);
    if (!this.fields.id) throw new Error("id required");
    const uuidOffset = UUID.createUUID(builder, Array.from(this.fields.id));
    Item.addId(builder, uuidOffset);
    if (this.fields.text) {
      // TODO: standardised method
      LWWTimestamp
      LWWRegisterString.createLWWRegisterString(
        builder,
        ,
        valueOffset,
      );
      Item.addText(builder, textOffset);
    }
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
