import { AirdayItem, type AirdayItemFields } from "./model";
import {
  LWWRegister,
  LWWTimestamp,
  type LWW,
  type SerialisedLWWRegister,
} from "../crdt/lww";
import { Builder, ByteBuffer, type Offset } from "flatbuffers";
import { AddItemAction as AddItemActionFB } from "../proto/add-item-action";
import { v4, parse } from "uuid";
import { AirdayMessage } from "../proto/airday-message";
import { AirdayAction } from "../proto/airday-action";
import { AirdayBatchComponent } from "../proto/airday-batch-component";
import { DeleteItemAction } from "../proto/delete-item-action";
import {
  Item,
  LWWRegisterString,
  LWWTimestamp as LWWTimestampFB,
} from "../proto";
import { UUID } from "../proto/uuid";

export interface SerialisedAirdayItem {
  id: string;
  text: SerialisedLWWRegister<string>;
}

class Action {
  id = v4();
  addToFlatBuffer(build: Builder): Offset {
    throw new Error("addToFlatBuffer not implemented");
  }
}

export class GetListsActions extends Action {
  constructor(item: AirdayItem) {
    super();
  }
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
      // TODO: standardised method(s)!
      const timestampOffset = LWWTimestampFB.createLWWTimestamp(
        builder,
        this.fields.text.timestamp.utc,
        this.fields.text.timestamp.pid,
        this.fields.text.timestamp.tick,
      );
      const valueOffset = builder.createString(this.fields.text.data);
      const textOffset = LWWRegisterString.createLWWRegisterString(
        builder,
        timestampOffset,
        valueOffset,
      );
      Item.addText(builder, textOffset);
    }
    const actionOffset = Item.endItem(builder);
    return actionOffset;
  }
}

function createAirdayMessage(actions: Action[]) {
  const builder = new Builder(1024);
  const batchOffsets = actions
    .map((action) => {
      if (action instanceof AddItemAction) {
        const itemOffset = action.addToFlatBuffer(builder);
        const actionOffset = AddItemActionFB.createAddItemAction(
          builder,
          itemOffset,
        );
        const batchOffset = AirdayBatchComponent.createAirdayBatchComponent(
          builder,
          AirdayAction.AddItemAction,
          actionOffset,
        );
        return batchOffset;
      }
      return null;
    })
    .filter((a) => a !== null);
  AirdayMessage.startAirdayMessage(builder);
  // const uuidOffset = UUID.createUUID(builder, Array.from(parse(v4()))); // TODO... wait where does this go...?
  batchOffsets.forEach((batchOffset) => {
    AirdayMessage.addBatch(builder, batchOffset);
  });
  AirdayMessage.endAirdayMessage(builder);
  return builder.asUint8Array();
}
