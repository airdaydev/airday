import { Builder, type Offset } from "flatbuffers";
import {
  SyncOpProto,
  AuthenticateActionProto,
  SpanContextProto,
  UuidProto,
  SyncStreamReqProto,
  MessageProto,
  ActionProto,
  MessageWrapperProto,
  BatchSyncProto,
  BatchComponentProto,
  OpKind,
} from "../proto";
import { tracer } from "../tracer";
import type { MQMessage } from "../websocket";
import type { ULSpan } from "@airday/tracer";
import { Uuidv4 } from "../common/uuid";
import { SyncObject } from "./sync-object";

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
    const messageWrapperOffset =
      MessageWrapperProto.endMessageWrapperProto(builder);
    builder.finish(messageWrapperOffset);
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
    BatchComponentProto.addOpId(builder, actionIdOffset);
    const offset = BatchComponentProto.endBatchComponentProto(builder);
    return offset;
  }
}

export class SyncStreamReqMessage extends AirdayMessage {
  id = new Uuidv4();
  libraryId: Uuidv4;
  serverSeq: bigint | null = null;
  type = MessageProto.SyncStreamReqProto;
  constructor(libraryId: Uuidv4, serverSeq: bigint | null = null) {
    super();
    this.libraryId = libraryId;
    this.serverSeq = serverSeq;
  }
  addToFlatBuffer(builder: Builder): Offset {
    SyncStreamReqProto.startSyncStreamReqProto(builder);
    SyncStreamReqProto.addLibraryId(
      builder,
      UuidProto.createUuidProto(builder, this.libraryId.toUUIDProto()),
    );
    if (this.serverSeq) {
      SyncStreamReqProto.addServerSeq(builder, this.serverSeq);
    }
    const messageOffset = SyncStreamReqProto.endSyncStreamReqProto(builder);
    return messageOffset;
  }
}

export class SyncOpFB extends BatchAction {
  syncObject: SyncObject;
  actionProto = ActionProto.SyncOpProto;
  constructor(syncObject: SyncObject) {
    super();
    this.syncObject = syncObject;
  }
  addToFlatBuffer(builder: Builder) {
    const vectorOffset = this.syncObject.toFlatBuffer(builder, true);
    SyncOpProto.startSyncOpProto(builder);
    SyncOpProto.addObjKind(builder, this.syncObject.objectType);
    SyncOpProto.addObjId(
      builder,
      UuidProto.createUuidProto(builder, this.syncObject.id.toUUIDProto()),
    );
    SyncOpProto.addLibraryId(
      builder,
      UuidProto.createUuidProto(
        builder,
        this.syncObject.libraryId.toUUIDProto(),
      ),
    );
    // TODO: This should be opaque for now but encrypted before release
    // SyncOpProto.addPayload(builder, vectorOffset);
    // SyncOpProto.addPayloadSha256(builder, vectorOffset);
    const actionOffset = SyncOpProto.endSyncOpProto(builder);
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
  addToFlatBuffer(builder: Builder) {
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
