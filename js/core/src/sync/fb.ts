import { Builder, type Offset } from "flatbuffers";
import {
  AuthenticateActionProto,
  SpanContextProto,
  UuidProto,
  SyncStreamReqProto,
  MessageProto,
  MessageWrapperProto,
  BatchSyncOpProto,
  AttrTypeProto,
  AttributeProto,
} from "../proto";
import { tracer } from "../tracer";
import type { MQMessage } from "../websocket";
import type { ULSpan } from "@airday/tracer";
import { Uuidv4 } from "../common/uuid";
import { SyncOp } from "./sync-op";
import { NumericAttrMap } from "./sync-object";

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

export function serialiseAttr(
  builder: Builder,
  patch: NumericAttrMap,
  fieldId: number,
) {
  const field = patch[fieldId];
  if (!field) {
    console.warn(`Could not find field ${fieldId} to serialise`);
    return false;
  }
  let strOffset;
  let valueType;
  switch (typeof field.data) {
    case "string": {
      valueType = AttrTypeProto.STRING;
      strOffset = builder.createString(field.data);
      break;
    }
    case "boolean": {
      valueType = AttrTypeProto.BOOL;
      break;
    }
    case "number": {
      valueType = AttrTypeProto.F64;
      break;
    }
    default: {
      console.warn(`unable to deserialise type=${typeof field.data}`);
      return false;
    }
  }
  AttributeProto.startAttributeProto(builder);
  AttributeProto.addFieldId(builder, fieldId);
  AttributeProto.addValueType(builder, valueType);
  AttributeProto.addTimestamp(
    builder,
    field.timestamp.addToFlatBuffer(builder),
  );
  if (strOffset) {
    AttributeProto.addString(builder, strOffset);
  }
  // TODO: Double type check...?
  if (valueType === AttrTypeProto.F64 && typeof field.data === "number") {
    AttributeProto.addF64Fb(builder, field.data);
  }
  if (valueType === AttrTypeProto.BOOL && typeof field.data === "boolean") {
    AttributeProto.addBool(builder, field.data);
  }
  return AttributeProto.endAttributeProto(builder);
}
