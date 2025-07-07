import { AirdayItem, type AirdayItemFields } from "./model";
import {
  LWWRegister,
  LWWTimestamp,
  type LWW,
  type SerialisedLWWRegister,
} from "../crdt/lww";
import { Builder, ByteBuffer, type Offset } from "flatbuffers";
import { v4 } from "uuid";
import {
  ItemProto,
  LWWRegisterStringProto,
  UUIDProto,
  AddItemActionProto,
  AirdayMessageProto,
  AirdayActionProto,
  AirdayBatchComponentProto,
  DeleteItemActionProto,
} from "../proto";
import { getUuidBytes } from "../common";
import { AirdayBatchComponent } from "../proto/airday-batch-component";

export interface SerialisedAirdayItem {
  id: string;
  text: SerialisedLWWRegister<string>;
}

class Action {
  id = v4();
  addToFlatBuffer(build: Builder): Offset {
    throw new Error("addToFlatBuffer not implemented");
  }
  toActionFlatBuffer(): Uint8Array {
    const builder = new Builder(1024);
    const actionOffset = this.addToFlatBuffer(builder);
    builder.finish(actionOffset);
    return builder.asUint8Array();
  }
}

export class GetListsActions extends Action {
  constructor(item: AirdayItem) {
    super();
  }
}

export function deserialiseAction(buffer: Uint8Array) {
  const bb = new ByteBuffer(buffer);
  const component =
    AirdayBatchComponentProto.getRootAsAirdayBatchComponentProto(bb);
  switch (component.actionType()) {
    case AirdayActionProto.AddItemActionProto: {
      const rObj = new AddItemActionProto();
      const addAction = component.action(rObj);
      const item = rObj.item(); // TODO: null vs non-existent
      if (!item) throw new Error("Item could not be found");
      return AddItemAction.fromItemFlatBuffer(item);
    }
    case AirdayActionProto.DeleteItemActionProto: {
      const rObj = new DeleteItemActionProto();
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
  static fromItemFlatBuffer(item: ItemProto) {
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
    ItemProto.startItemProto(builder);
    if (!this.fields.id) throw new Error("id required");
    const uuidOffset = UUIDProto.createUUIDProto(
      builder,
      Array.from(this.fields.id),
    );
    ItemProto.addId(builder, uuidOffset);
    if (this.fields.text) {
      const timestampOffset =
        this.fields.text.timestamp.addToFlatBuffer(builder);
      const valueOffset = builder.createString(this.fields.text.data);
      const textOffset = LWWRegisterStringProto.createLWWRegisterStringProto(
        builder,
        timestampOffset,
        valueOffset,
      );
      ItemProto.addText(builder, textOffset);
    }
    const itemOffset = ItemProto.endItemProto(builder);
    const actionOffset = AddItemActionProto.createAddItemActionProto(
      builder,
      itemOffset,
    );
    return actionOffset;
  }
}

export function createAirdayMessage(actions: Action[]) {
  const builder = new Builder(1024);
  const batchOffsets = actions
    .map((action) => {
      if (action instanceof AddItemAction) {
        const actionOffset = action.addToFlatBuffer(builder);
        const batchOffset =
          AirdayBatchComponentProto.createAirdayBatchComponentProto(
            builder,
            AirdayActionProto.AddItemActionProto,
            actionOffset,
          );
        return batchOffset;
      }
      return null;
    })
    .filter((a) => a !== null);
  AirdayMessageProto.startAirdayMessageProto(builder);
  // const uuidOffset = UUID.createUUID(builder, Array.from(parse(v4()))); // TODO... wait where does this go...?
  batchOffsets.forEach((batchOffset) => {
    AirdayMessageProto.addBatch(builder, batchOffset);
  });
  AirdayMessageProto.endAirdayMessageProto(builder);
  return builder.asUint8Array();
}
