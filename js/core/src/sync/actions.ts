import { AirdayItem, type AirdayItemFields } from "./model";
import { LWWRegisterString, LWWTimestamp } from "../crdt/lww";
import { Builder, ByteBuffer, type Offset } from "flatbuffers";
import {
  ItemProto,
  LWWRegisterStringProto,
  AddItemActionProto,
  AirdayMessageProto,
  AirdayActionProto,
  AirdayBatchComponentProto,
  DeleteItemActionProto,
  MessageWrapperProto,
  MessageProto,
  AuthenticateActionProto,
  SpanContextProto,
} from "../proto";
import { tracer } from "../tracer";
import type { MQMessage } from "../websocket/mq";
import type { ULSpan } from "@airday/tracer";
import { Uuidv4 } from "../common";

class Action {
  id = new Uuidv4();
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

export class AuthenticateAction extends Action {
  sessionToken: string;
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
    const offset = AirdayBatchComponentProto.createAirdayBatchComponentProto(
      builder,
      AirdayActionProto.AuthenticateActionProto,
      actionOffset,
    );
    return offset;
  }
}

export class AddItemAction extends Action {
  workspaceId = new Uuidv4(); // TODO: WRONG, should be taken from outside
  fields: Partial<AirdayItemFields> = {};
  constructor(fields: Partial<AirdayItemFields>) {
    super();
    this.fields = fields;
  }
  static fromItemFlatBuffer(item: ItemProto) {
    const fields: Partial<AirdayItemFields> = {};
    const id = item.idArray();
    if (id) {
      fields.id = Uuidv4.from(id);
    }
    const text = item.text();
    const textTimestamp = item.text()?.timestamp();
    if (text && textTimestamp) {
      // TODO: Make this its own function
      const timestamp = new LWWTimestamp({
        utc: textTimestamp.utc(),
        pid: textTimestamp.pid(),
      });
      fields.text = new LWWRegisterString({
        timestamp,
        data: text.data() || "",
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
    if (!this.fields.id) throw new Error("id required");
    const idOffset = ItemProto.createIdVector(builder, this.fields.id);
    ItemProto.startItemProto(builder);
    ItemProto.addId(builder, idOffset);
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
    const workspaceIdOffset = AddItemActionProto.createWorkspaceIdVector(
      builder,
      this.workspaceId,
    );
    AddItemActionProto.startAddItemActionProto(builder);
    AddItemActionProto.addWorkspaceId(builder, workspaceIdOffset);
    AddItemActionProto.addItem(builder, itemOffset);
    const actionOffset = AddItemActionProto.endAddItemActionProto(builder);
    const batchComponentOffset =
      AirdayBatchComponentProto.createAirdayBatchComponentProto(
        builder,
        AirdayActionProto.AddItemActionProto,
        actionOffset,
      );
    return batchComponentOffset;
  }
}

export class AirdayBatchMessage implements MQMessage {
  actions: Action[];
  span?: ULSpan;
  constructor(actions: Action[]) {
    this.actions = actions;
  }
  toFlatBuffer() {
    const builder = new Builder(1024);

    // 1. Build action batch components
    const batchOffsets = this.actions
      .map((action) => action.addToFlatBuffer(builder))
      .filter((a) => a !== null);

    // 2. Build AridayMessageProto (contains batches)
    const batch = AirdayMessageProto.createBatchVector(builder, batchOffsets);
    AirdayMessageProto.startAirdayMessageProto(builder);
    AirdayMessageProto.addBatch(builder, batch);
    let messageOffset = AirdayMessageProto.endAirdayMessageProto(builder);

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

    // 3. Builds message wrapper (distinguishes it from JMAPMessageProto)
    MessageWrapperProto.startMessageWrapperProto(builder);
    MessageWrapperProto.addMessageType(
      builder,
      MessageProto.AirdayMessageProto,
    );
    MessageWrapperProto.addMessage(builder, messageOffset);
    MessageWrapperProto.addSpanContext(builder, spanContextOffset);

    let wrapper = MessageWrapperProto.endMessageWrapperProto(builder);
    builder.finish(wrapper);
    return builder.asUint8Array();
  }
  complete() {
    // TODO: Show error/failure
    if (this.span) {
      tracer.endSpan(this.span);
    }
  }
}
