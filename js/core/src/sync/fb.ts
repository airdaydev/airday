import { Builder, ByteBuffer, type Offset } from "flatbuffers";
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
  AttributeSetProto,
} from "../proto";
import { tracer } from "../tracer";
import type { MQMessage } from "../websocket";
import type { ULSpan } from "@airday/tracer";
import { Uuidv4 } from "../common/uuid";
import { SyncOp } from "./sync-op";
import { NumericAttrMap } from "./sync-object";
import { LWWRegister, LWWTimestamp } from "../crdt/lww";

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
  streamId = new Uuidv4();
  libraryId: Uuidv4;
  seq: bigint | null = null;
  type = MessageProto.SyncStreamReqProto;
  constructor(streamId: Uuidv4, libraryId: Uuidv4, seq: bigint | null = null) {
    super();
    this.streamId = streamId;
    this.libraryId = libraryId;
    this.seq = seq;
  }
  addToFlatBuffer(builder: Builder): Offset {
    SyncStreamReqProto.startSyncStreamReqProto(builder);
    SyncStreamReqProto.addStreamId(
      builder,
      UuidProto.createUuidProto(builder, this.streamId.toUUIDProto()),
    );
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

export function deserialiseAttr(attr: AttributeProto) {
  const type = attr.valueType();
  const rawTimestamp = attr.timestamp();
  if (!rawTimestamp) {
    throw new Error(`No timestamp found while deserialising attr!`);
  }
  const timestamp = LWWTimestamp.fromProto(rawTimestamp);
  let data;
  switch (type) {
    case AttrTypeProto.BOOL: {
      data = attr.bool();
      break;
    }
    case AttrTypeProto.STRING: {
      data = attr.string();
      break;
    }
    case AttrTypeProto.F64: {
      data = attr.f64Fb();
      break;
    }
    case AttrTypeProto.I64: {
      data = attr.i64Fb();
      break;
    }
    case AttrTypeProto.BYTES: {
      // TODO: Bytes is currently obviously not working
      data = attr.bytes(0);
      break;
    }
    default: {
      throw new Error(`Unknown type - cannot deserialise`);
    }
  }
  return new LWWRegister({
    data,
    timestamp,
  });
}

export function parseAttrSet(buffer: Uint8Array) {
  const state: NumericAttrMap = {};
  const bb = new ByteBuffer(buffer);
  const attrSet = AttributeSetProto.getRootAsAttributeSetProto(bb);
  for (let i = 0; i < attrSet.attributesLength(); i++) {
    const attr = attrSet.attributes(i);
    if (attr) {
      const lww = deserialiseAttr(attr);
      state[attr.fieldId()] = lww;
    }
  }
  return state;
}

interface Decoder {
  decodeFrame(frame: MessageEvent): Message[];
  decodeSyncBatch(payload: Uint8Array): DecodedSyncBatch;
}

function decodeFrame(messageEvent: MessageEvent) {
  if (messageEvent.type === "message") {
    // TODO: parse binary messages here, then provide response subscription system
    const uint8Array = new Uint8Array(messageEvent.data);

    const bb = new ByteBuffer(uint8Array);
    const msg = MessageWrapperProto.getRootAsMessageWrapperProto(bb);
    const span = spanFromFlatbuffer(msg.spanContext(), "ws:receive");
    // TODO: Unwrap span dedicated function
    // TODO: Validate batch/extract span
    this.handleAirdayMessage(span, msg);
  }
}
