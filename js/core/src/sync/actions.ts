import { AirdayItem } from "./model";
import { Builder, ByteBuffer, type Offset } from "flatbuffers";
import {
  ItemProto,
  LWWRegisterStringProto,
  SyncItemActionProto,
  AuthenticateActionProto,
  SpanContextProto,
  UuidProto,
  SyncStreamReqProto,
  ResourceType,
  MessageProto,
  ActionProto,
  MessageWrapperProto,
  BatchSyncProto,
  BatchComponentProto,
} from "../proto";
import { tracer } from "../tracer";
import type { MQMessage } from "../websocket";
import type { ULSpan } from "@airday/tracer";
import { Uuidv4 } from "../common/uuid";

export class AirdayMessage implements MQMessage {
  span?: ULSpan;
  type: MessageProto = MessageProto.NONE;
  addToFlatBuffer(builder: Builder): Offset {
    throw new Error("Not yet implemented");
  }
  serialise() {
    const builder = new Builder(1024);
    // Construct span
    const span = tracer.startSpan("ws_send");
    this.span = span;
    // tracer.addTag(span, "action_count", this.actions.length);
    const traceIdOffset = SpanContextProto.createTraceIdVector(
      builder,
      span.traceId,
    );
    SpanContextProto.startSpanContextProto(builder);
    SpanContextProto.addSpanId(builder, span.spanId.toBigInt());
    SpanContextProto.addTraceId(builder, traceIdOffset);
    const spanContextOffset = SpanContextProto.endSpanContextProto(builder);
    // Construct message
    const messageOffset = this.addToFlatBuffer(builder);
    // Construct message
    MessageWrapperProto.startMessageWrapperProto(builder);
    MessageWrapperProto.addSpanContext(builder, spanContextOffset);
    MessageWrapperProto.addMessageType(builder, this.type);
    MessageWrapperProto.addMessage(builder, messageOffset);
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

export class BatchAction {
  id = new Uuidv4();
  sent = 0; // send attempts over websockets
  actionProto: ActionProto = ActionProto.NONE;
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
    if (this.actionProto === ActionProto.NONE) {
      throw new Error(
        "No action type given while constructing batch component",
      );
    }
    BatchComponentProto.startBatchComponentProto(builder);
    BatchComponentProto.addActionType(builder, this.actionProto);
    BatchComponentProto.addAction(builder, actionOffset);
    const actionIdOffset = UuidProto.createUuidProto(
      builder,
      this.id.toUUIDProto(),
    );
    BatchComponentProto.addActionId(builder, actionIdOffset);
    const offset = BatchComponentProto.endBatchComponentProto(builder);
    return offset;
  }
}

export class SyncStreamReqMessage extends AirdayMessage {
  id = new Uuidv4();
  libraryId: Uuidv4;
  serverTimestamp: bigint | null = null;
  type = MessageProto.SyncStreamReqProto;
  resourceType: ResourceType;
  constructor(
    resourceType: ResourceType,
    libraryId: Uuidv4,
    serverTimestamp: bigint | null = null,
  ) {
    super();
    this.resourceType = resourceType;
    this.libraryId = libraryId;
    this.serverTimestamp = serverTimestamp;
  }
  addToFlatBuffer(builder: Builder): Offset {
    SyncStreamReqProto.startSyncStreamReqProto(builder);
    SyncStreamReqProto.addLibraryId(
      builder,
      UuidProto.createUuidProto(builder, this.id.toUUIDProto()),
    );
    SyncStreamReqProto.addResource(builder, ResourceType.Item);
    if (this.serverTimestamp) {
      SyncStreamReqProto.addServerTimestamp(builder, this.serverTimestamp);
    }
    const messageOffset = SyncStreamReqProto.endSyncStreamReqProto(builder);
    return messageOffset;
  }
}

export class SyncItemAction extends BatchAction {
  item: AirdayItem;
  dirty = false;
  actionProto = ActionProto.SyncItemActionProto;
  constructor(item: AirdayItem) {
    super();
    this.item = item;
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
    SyncItemActionProto.startSyncItemActionProto(builder);
    SyncItemActionProto.addItem(builder, itemOffset);
    const actionOffset = SyncItemActionProto.endSyncItemActionProto(builder);
    return this.buildBatchComponent(builder, actionOffset);
  }
}

export class AuthenticateAction extends AirdayMessage {
  sessionToken: string;
  type = MessageProto.AuthenticateActionProto;
  constructor(sessionToken: string) {
    super();
    this.sessionToken = sessionToken;
  }
  addToFlatBuffer(builder: Builder): Offset {
    const sessionTokenOffset = builder.createString(this.sessionToken);
    const messageOffset = AuthenticateActionProto.createAuthenticateActionProto(
      builder,
      sessionTokenOffset,
    );
    return messageOffset;
  }
}

export class BatchSyncMessage extends AirdayMessage {
  actions: BatchAction[];
  type = MessageProto.BatchSyncProto;
  constructor(actions: BatchAction[]) {
    super();
    this.actions = actions;
  }
  toFlatBuffer(builder: Builder) {
    // 1. Build action batch components
    const batchOffsets = this.actions
      .map((action) => action.addToFlatBuffer(builder))
      .filter((a) => a !== null);
    // 1. Build message
    const batch = BatchSyncProto.createBatchVector(builder, batchOffsets);
    BatchSyncProto.startBatchSyncProto(builder);
    BatchSyncProto.addBatch(builder, batch);
    let batchOffset = BatchSyncProto.endBatchSyncProto(builder);
    return batchOffset;
  }
}
