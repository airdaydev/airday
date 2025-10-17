import { Builder, type Offset } from "flatbuffers";
import {
  SyncOpProto,
  AuthenticateActionProto,
  SpanContextProto,
  UuidProto,
  SyncStreamReqProto,
  MessageProto,
  MessageWrapperProto,
  OpKind,
  BatchSyncOpProto,
} from "../proto";
import { tracer } from "../tracer";
import type { MQMessage } from "../websocket";
import type { ULSpan } from "@airday/tracer";
import { Uuidv4 } from "../common/uuid";
import { NumericAttrMap, SyncObject } from "./sync-object";

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

export class SyncStreamReqMessage extends AirdayMessage {
  id = new Uuidv4();
  libraryId: Uuidv4;
  seq: bigint | null = null;
  type = MessageProto.SyncStreamReqProto;
  constructor(libraryId: Uuidv4, seq: bigint | null = null) {
    super();
    this.libraryId = libraryId;
    this.seq = seq;
  }
  addToFlatBuffer(builder: Builder): Offset {
    SyncStreamReqProto.startSyncStreamReqProto(builder);
    SyncStreamReqProto.addLibraryId(
      builder,
      UuidProto.createUuidProto(builder, this.libraryId.toUUIDProto()),
    );
    if (this.seq) {
      SyncStreamReqProto.addSeq(builder, this.seq);
    }
    const messageOffset = SyncStreamReqProto.endSyncStreamReqProto(builder);
    return messageOffset;
  }
}

export class SyncOp {
  syncObject: SyncObject;
  id = new Uuidv4();
  opKind: OpKind;
  payload?: Uint8Array;
  constructor(syncObject: SyncObject, opKind = OpKind.PATCH) {
    this.syncObject = syncObject;
    this.opKind = opKind;
  }
  toIdb() {
    return {
      id: this.id,
      opKind: OpKind,
      libraryId: this.syncObject.libraryId,
      objId: this.syncObject.id,
      objKind: this.syncObject.objKind,
      payload: this.payload,
    };
  }
  addToFlatBuffer(builder: Builder) {
    let vectorOffset;
    if (this.payload) {
      vectorOffset = builder.createByteVector(this.payload);
    }
    SyncOpProto.startSyncOpProto(builder);
    SyncOpProto.addProtoVersion(builder, 1);
    SyncOpProto.addOpId(
      builder,
      UuidProto.createUuidProto(builder, this.id.toUUIDProto()),
    );
    SyncOpProto.addOpKind(builder, this.opKind);
    SyncOpProto.addObjKind(builder, this.syncObject.objKind);
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
    // TODO: e2ee payload
    if (vectorOffset) {
      SyncOpProto.addPayload(builder, vectorOffset);
    }
    const offset = SyncOpProto.endSyncOpProto(builder);
    return offset;
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
  actions: SyncOp[];
  type = MessageProto.BatchSyncOpProto;
  constructor(actions: SyncOp[]) {
    super();
    this.actions = actions;
  }
  addToFlatBuffer(builder: Builder) {
    // 1. Build action batch components
    const batchOffsets = this.actions
      .map((action) => action.addToFlatBuffer(builder))
      .filter((a) => a !== null);
    // 2. Build message
    const batch = BatchSyncOpProto.createBatchVector(builder, batchOffsets);
    BatchSyncOpProto.startBatchSyncOpProto(builder);
    BatchSyncOpProto.addBatch(builder, batch);
    let batchOffset = BatchSyncOpProto.endBatchSyncOpProto(builder);
    return batchOffset;
  }
}
