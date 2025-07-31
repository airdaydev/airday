import { AirdayItem, type AirdayItemAttributes } from "./model";
import { LWWRegister, LWWRegisterString, LWWTimestamp } from "../crdt/lww";
import { Builder, ByteBuffer, type Offset } from "flatbuffers";
import {
  ItemProto,
  LWWRegisterStringProto,
  AddItemActionProto,
  AirdayMessageProto,
  AirdayActionProto,
  AirdayBatchComponentProto,
  DeleteItemActionProto,
  AuthenticateActionProto,
  SpanContextProto,
} from "../proto";
import { tracer } from "../tracer";
import type { MQMessage } from "../websocket";
import type { ULSpan } from "@airday/tracer";
import { Uuidv4 } from "../uuid";
import type { AirdayCore } from "../core";

export class AirdayAction {
  id = new Uuidv4();
  sent = 0; // send attempts over websockets
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

export class GetListsActions extends AirdayAction {
  constructor(item: AirdayItem) {
    super();
  }
}

// Was used for WAL
// Can be adapted for replies
// export function deserialiseAction(buffer: Uint8Array) {
//   const bb = new ByteBuffer(buffer);
//   const component =
//     AirdayBatchComponentProto.getRootAsAirdayBatchComponentProto(bb);
//   switch (component.actionType()) {
//     case AirdayActionProto.AddItemActionProto: {
//       const rObj = new AddItemActionProto();
//       const addAction = component.action(rObj);
//       const item = rObj.item(); // TODO: null vs non-existent
//       if (!item) throw new Error("Item could not be found");
//       return AddItemAction.fromItemFlatBuffer(item);
//       AddItemAction.from;
//     }
//     case AirdayActionProto.DeleteItemActionProto: {
//       const rObj = new DeleteItemActionProto();
//       const deleteAction = component.action(rObj);
//       break;
//     }
//   }
// }

export class AuthenticateAction extends AirdayAction {
  sessionToken: string;
  constructor(sessionToken: string) {
    super();
    this.sessionToken = sessionToken;
  }
  addToFlatBuffer(builder: Builder): Offset {
    const sessionTokenOffset = builder.createString(this.sessionToken);
    const actionIdOffset = AirdayBatchComponentProto.createActionIdVector(
      builder,
      this.id,
    );
    const actionOffset = AuthenticateActionProto.createAuthenticateActionProto(
      builder,
      sessionTokenOffset,
    );
    AirdayBatchComponentProto.startAirdayBatchComponentProto(builder);
    AirdayBatchComponentProto.addActionType(
      builder,
      AirdayActionProto.AuthenticateActionProto,
    );
    AirdayBatchComponentProto.addAction(builder, actionOffset);
    AirdayBatchComponentProto.addActionId(builder, actionIdOffset);
    const offset =
      AirdayBatchComponentProto.endAirdayBatchComponentProto(builder);
    return offset;
  }
}

export class AddItemAction extends AirdayAction {
  item: AirdayItem;
  dirty = false;
  constructor(item: AirdayItem) {
    super();
    this.item = item;
  }
  // Coul be Used for inverse - to apply from server
  static fromItemFlatBuffer(item: ItemProto) {
    // const fields: Partial<AirdayItemAttributes> = {};
    // const id = item.idArray();
    // if (id) {
    //   fields.id = Uuidv4.from(id);
    // }
    // const text = item.text();
    // const textTimestamp = item.text()?.timestamp();
    // if (text && textTimestamp) {
    //   // TODO: Make this its own function
    //   const timestamp = new LWWTimestamp({
    //     utc: textTimestamp.utc(),
    //     pid: textTimestamp.pid(),
    //   });
    //   fields.text = new LWWRegisterString({
    //     timestamp,
    //     data: text.data() || "",
    //   });
    // }
    // return new AddItemAction(fields);
  }
  addToFlatBuffer(builder: Builder) {
    const libraryIdOffset = ItemProto.createLibraryIdVector(
      builder,
      this.item.libraryId,
    );
    const idOffset = ItemProto.createIdVector(builder, this.item.id);
    let textOffset;
    if (this.item.attributes.text) {
      const valueOffset = builder.createString(this.item.attributes.text.data);
      LWWRegisterStringProto.startLWWRegisterStringProto(builder);
      const timestampOffset =
        this.item.attributes.text.timestamp.addToFlatBuffer(builder);
      LWWRegisterStringProto.addTimestamp(builder, timestampOffset);
      LWWRegisterStringProto.addData(builder, valueOffset);
      textOffset = LWWRegisterStringProto.endLWWRegisterStringProto(builder);
    }
    ItemProto.startItemProto(builder);
    if (textOffset) {
      ItemProto.addText(builder, textOffset);
    }
    ItemProto.addId(builder, idOffset);
    ItemProto.addLibraryId(builder, libraryIdOffset);
    const itemOffset = ItemProto.endItemProto(builder);
    AddItemActionProto.startAddItemActionProto(builder);
    AddItemActionProto.addItem(builder, itemOffset);
    const actionOffset = AddItemActionProto.endAddItemActionProto(builder);
    const actionIdOffset = AirdayBatchComponentProto.createActionIdVector(
      builder,
      this.id,
    );
    AirdayBatchComponentProto.startAirdayBatchComponentProto(builder);
    AirdayBatchComponentProto.addActionType(
      builder,
      AirdayActionProto.AddItemActionProto,
    );
    AirdayBatchComponentProto.addAction(builder, actionOffset);
    AirdayBatchComponentProto.addActionId(builder, actionIdOffset);
    const batchComponentOffset =
      AirdayBatchComponentProto.endAirdayBatchComponentProto(builder);
    return batchComponentOffset;
  }
}

export class AirdayBatchMessage implements MQMessage {
  actions: AirdayAction[];
  span?: ULSpan;
  constructor(actions: AirdayAction[]) {
    this.actions = actions;
  }
  toFlatBuffer() {
    const builder = new Builder(1024);

    // 1. Build action batch components
    const batchOffsets = this.actions
      .map((action) => action.addToFlatBuffer(builder))
      .filter((a) => a !== null);

    // 2. Tracing
    // TODO: Improve instrumentation
    const span = tracer.startSpan("ws_send");
    this.span = span;
    tracer.addTag(span, "action_count", this.actions.length);
    const traceIdOffset = SpanContextProto.createTraceIdVector(
      builder,
      span.traceId,
    );
    SpanContextProto.startSpanContextProto(builder);
    SpanContextProto.addSpanId(builder, span.spanId.toBigInt());
    SpanContextProto.addTraceId(builder, traceIdOffset);
    const spanContextOffset = SpanContextProto.endSpanContextProto(builder);

    // 2. Build AridayMessageProto (contains batches)
    const batch = AirdayMessageProto.createBatchVector(builder, batchOffsets);
    AirdayMessageProto.startAirdayMessageProto(builder);
    AirdayMessageProto.addBatch(builder, batch);
    AirdayMessageProto.addSpanContext(builder, spanContextOffset);
    let messageOffset = AirdayMessageProto.endAirdayMessageProto(builder);

    builder.finish(messageOffset);
    return builder.asUint8Array();
  }
  complete() {
    // TODO: Show error/failure
    if (this.span) {
      tracer.endSpan(this.span);
    }
  }
}
