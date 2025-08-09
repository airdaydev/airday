import { AirdayItem, type AirdayItemAttributes } from "./model";
import { LWWRegister, LWWRegisterString, LWWTimestamp } from "../crdt/lww";
import { Builder, ByteBuffer, type Offset } from "flatbuffers";
import {
  ItemProto,
  LWWRegisterStringProto,
  UpsertItemActionProto,
  AirdayMessageProto,
  AirdayActionProto,
  AirdayBatchComponentProto,
  DeleteItemActionProto,
  AuthenticateActionProto,
  SpanContextProto,
  UuidProto,
  ItemSyncReqProto,
} from "../proto";
import { tracer } from "../tracer";
import type { MQMessage } from "../websocket";
import type { ULSpan } from "@airday/tracer";
import { Uuidv4 } from "../common/uuid";
import type { AirdayCore } from "../core";

// function buildBatchComponent(
//   builder: Builder,
//   actionProto: AirdayActionProto,
//   actionOffset: Offset,
// ) {
// AirdayBatchComponentProto.startAirdayBatchComponentProto(builder);
// AirdayBatchComponentProto.addActionType(
//   builder,
//   AirdayActionProto.AuthenticateActionProto,
// );
// AirdayBatchComponentProto.addAction(builder, actionOffset);
// const actionIdOffset = UuidProto.createUuidProto(
//   builder,
//   this.id.toUUIDProto(),
// );
// AirdayBatchComponentProto.addActionId(builder, actionIdOffset);
// const offset =
//   AirdayBatchComponentProto.endAirdayBatchComponentProto(builder);
// return offset;
// }

export class AirdayAction {
  id = new Uuidv4();
  sent = 0; // send attempts over websockets
  actionProto?: AirdayActionProto;
  addToFlatBuffer(builder: Builder): Offset {
    throw new Error("addToFlatBuffer not implemented");
  }
  toActionFlatBuffer(): Uint8Array {
    const builder = new Builder(1024);
    const actionOffset = this.addToFlatBuffer(builder);
    builder.finish(actionOffset);
    return builder.asUint8Array();
  }
  buildBatchComponent(builder: Builder, actionOffset: Offset): Offset {
    if (!this.actionProto) throw new Error("Not yet implemented");
    AirdayBatchComponentProto.startAirdayBatchComponentProto(builder);
    AirdayBatchComponentProto.addActionType(builder, this.actionProto);
    AirdayBatchComponentProto.addAction(builder, actionOffset);
    const actionIdOffset = UuidProto.createUuidProto(
      builder,
      this.id.toUUIDProto(),
    );
    AirdayBatchComponentProto.addActionId(builder, actionIdOffset);
    const offset =
      AirdayBatchComponentProto.endAirdayBatchComponentProto(builder);
    return offset;
  }
}

export class GetListsActions extends AirdayAction {
  constructor(item: AirdayItem) {
    super();
  }
}

export class ItemSyncReqAction extends AirdayAction {
  libraryId: Uuidv4;
  serverTimestamp: number | null = null;
  actionProto = AirdayActionProto.ItemSyncReqProto;
  constructor(libraryId: Uuidv4, serverTimestamp: number | null = null) {
    super();
    this.libraryId = libraryId;
    this.serverTimestamp = serverTimestamp;
  }
  addToFlatBuffer(builder: Builder): Offset {
    ItemSyncReqProto.startItemSyncReqProto(builder);
    ItemSyncReqProto.addLibraryId(
      builder,
      UuidProto.createUuidProto(builder, this.id.toUUIDProto()),
    );
    if (this.serverTimestamp) {
      ItemSyncReqProto.addServerTimestamp(builder, this.serverTimestamp);
    }
    const actionOffset = ItemSyncReqProto.endItemSyncReqProto(builder);
    return this.buildBatchComponent(builder, actionOffset);
  }
}

export class AuthenticateAction extends AirdayAction {
  sessionToken: string;
  actionProto = AirdayActionProto.AuthenticateActionProto;
  constructor(sessionToken: string) {
    super();
    this.sessionToken = sessionToken;
  }
  addToFlatBuffer(builder: Builder): Offset {
    const sessionTokenOffset = builder.createString(this.sessionToken);
    const actionOffset = AuthenticateActionProto.createAuthenticateActionProto(
      builder,
      sessionTokenOffset,
    );
    return this.buildBatchComponent(builder, actionOffset);
  }
}

export class UpsertItemAction extends AirdayAction {
  item: AirdayItem;
  dirty = false;
  actionProto = AirdayActionProto.UpsertItemActionProto;
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
    // return new UpsertItemAction(fields);
  }
  addToFlatBuffer(builder: Builder) {
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
    ItemProto.addId(
      builder,
      UuidProto.createUuidProto(builder, this.item.id.toUUIDProto()),
    );
    ItemProto.addLibraryId(
      builder,
      UuidProto.createUuidProto(builder, this.item.libraryId.toUUIDProto()),
    );
    const itemOffset = ItemProto.endItemProto(builder);
    UpsertItemActionProto.startUpsertItemActionProto(builder);
    UpsertItemActionProto.addItem(builder, itemOffset);
    const actionOffset =
      UpsertItemActionProto.endUpsertItemActionProto(builder);
    return this.buildBatchComponent(builder, actionOffset);
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
