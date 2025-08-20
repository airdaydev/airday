import { ByteBuffer } from "flatbuffers";
import {
  SyncObjectActionProto,
  ActionProto,
  MessageWrapperProto,
  AuthenticateResponseProto,
  LibrarySyncResponseProto,
  MessageProto,
  BatchSyncProto,
  BatchResponseProto,
} from "../proto";
import { AuthMode, Library, type AirdayCore } from "../core";
import { AuthenticateAction } from "../sync/actions";
import { stringify } from "uuid";
import { Uuidv4 } from "../common/uuid";
import { EventEmitter } from "../common/events";
import { spanFromFlatbuffer, tracer } from "../tracer";
import { ULSpan } from "@airday/tracer";

export interface BatchResponseEvent {
  actionId: Uuidv4;
  success: boolean;
  serverSeq?: bigint; // TODO
  error?: string;
}

interface WSEventMap {
  authenticated: { userId: Uuidv4; libraryId: Uuidv4 };
  ["batch-response"]: BatchResponseEvent;
  flushed: {};
}

export interface MQMessage {
  serialise(): Uint8Array;
}

export interface QueuedMessage {
  message: MQMessage;
}

// TODO: Offline considerations
export class WebsocketManager {
  core: AirdayCore;
  ws: WebSocket | null = null;
  address: URL;
  events = new EventEmitter<WSEventMap>();
  connected = false;
  authorised = false;
  // Queue
  intervalId: number | null = null;
  maxBatch = 50; // Messages to send at once
  maxBufferedAmount = 1024 * 1024; // 1MB
  outgoing: Array<QueuedMessage> = [];
  constructor(core: AirdayCore) {
    this.core = core;
    const address = core.root;
    address.pathname = "ws";
    this.address = address;
  }
  connect() {
    console.debug(`WS connection attempt to ${this.address}`);
    this.ws = new WebSocket(this.address);
    this.ws.binaryType = "arraybuffer";
    this.ws.addEventListener("message", this.listener);
    this.ws.addEventListener("error", (error) => {
      console.error("error");
    });
    this.ws.addEventListener("close", (event) => {
      this.connected = false;
      console.error("closed");
    });
    this.ws.addEventListener("open", (event) => {
      this.connected = true;
      if (this.core.authMode === AuthMode.BearerToken) {
        this.bearerAuth();
      }
      // TODO: Re. cookie auth... send same message on server to ensure core is authorised
    });
  }
  private bearerAuth() {
    if (!this.ws) throw new Error("WS is not enabled");
    if (!this.core.session?.token) {
      console.warn("Cannot websocket bearer auth, no bearer token");
      return;
    }
    const msg = new AuthenticateAction(this.core.session.token);
    console.debug("WS: Sending", msg, "action");
    this.ws.send(msg.serialise());
    msg.complete();
  }
  send(data: any) {
    if (!this.ws) throw new Error("Cannot send, WS is not enabled");
    // if (!this.authorised) {
    //   throw new Error("Attempted to use ws connection while not authorised");
    // }
    return this.ws.send(data);
  }
  close() {
    if (!this.ws) throw new Error("Cannot close, WS is not enabled");
    return this.ws.close();
  }
  // Explicit reconnect is useful for doing cookie authorisation
  reconnect() {}
  listener = (messageEvent: MessageEvent) => {
    // TODO: Unwrap span here!
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
  };
  enqueue(message: QueuedMessage) {
    this.outgoing.push(message);
    this.start();
  }
  enqueueAirdayMessage(message: MQMessage) {
    const queuedMessage: QueuedMessage = {
      message,
    };
    this.enqueue(queuedMessage);
  }
  get overflowed() {
    if (!this.ws) return true;
    return this.ws.bufferedAmount > this.maxBufferedAmount;
  }
  next() {
    if (!this.authorised || this.outgoing.length === 0 || this.overflowed) {
      return;
    }
    // 2. Form batch
    const batch: QueuedMessage[] = [];
    while (this.outgoing.length > 0 && batch.length < this.maxBatch) {
      const item = this.outgoing[0];
      this.outgoing.shift();
      batch.push(item);
    }
    this.wsSend(batch);
    if (this.outgoing.length === 0) {
      this.events.emit("flushed", {});
      this.stop(); // stop until we start again
    }
  }
  async wsSend(batch: Array<QueuedMessage>) {
    batch.map((item) => {
      this.send(item.message.serialise());
    });
  }
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.intervalId = null;
  }
  start() {
    // TODO: Start at 150ms and tune
    if (this.intervalId) return; // Do nothing if interval is already going
    this.intervalId = setInterval(() => this.next(), 150);
  }
  flush() {
    return new Promise((resolve) => {
      if (this.outgoing.length === 0) resolve(null);
      this.events.once("flushed", resolve);
    });
  }
  // TODO Consider moving this into subhandler
  private handleAirdayMessage(span: ULSpan, wrapper: MessageWrapperProto) {
    if (!wrapper) return;

    const type = wrapper.messageType();
    switch (type) {
      case MessageProto.AuthenticateResponseProto: {
        tracer.addTag(span, "msg_type", "AuthenticateResponseProto");
        const authResponse = new AuthenticateResponseProto();
        wrapper.message(authResponse);
        const userId = Uuidv4.fromFBProto(authResponse.userId());
        const libraryId = Uuidv4.fromFBProto(authResponse.libraryId());
        // Confirm things make sense and authorise
        // TODO: Confirm library id valid
        this.authorised = this.core.session?.userId === stringify(userId);
        this.core.library.id = libraryId; // TODO: Handle previous library/store?
        if (!this.authorised) {
          console.warn(this.core.session?.userId, stringify(userId), "huh");
        } else {
          this.events.emit("authenticated", {
            userId,
            libraryId,
          });
        }
        // TODO: Consider "auth" notification using JS native events
        this.start();
        break;
      }
      case MessageProto.LibrarySyncResponseProto: {
        tracer.addTag(span, "msg_type", "LibrarySyncResponseProto");
        const libraryResponse = new LibrarySyncResponseProto();
        wrapper.message(libraryResponse);
        const primaryLibraryBuffer = libraryResponse.primaryLibrary();
        if (primaryLibraryBuffer) {
          // TODO: Validate and add item to storage
          let id = Uuidv4.fromFBProto(primaryLibraryBuffer.id());
          let name = primaryLibraryBuffer.name() || "";
          this.core.library = new Library({
            id,
            name,
            local: true,
          });
          console.log(this.core.library);
        }
        break;
      }
      case MessageProto.BatchSyncProto: {
        const batchMsg = new BatchSyncProto();
        wrapper.message(batchMsg);
        this.processBatchMessage(span, batchMsg);
      }
    }
  }
  private processBatchMessage(span: ULSpan, batchMsg: BatchSyncProto) {
    // TODO: Check stream info
    const batchLength = batchMsg.batchLength();
    for (let i = 0; i < batchLength; i++) {
      const component = batchMsg.batch(i);
      if (!component) continue;

      const actionId = Uuidv4.fromFBProto(component.actionId());
      const actionType = component.actionType();

      switch (actionType) {
        case ActionProto.SyncObjectActionProto:
          tracer.addTag(span, "msg_type", "SyncObjectActionProto");
          const objectResponse = new SyncObjectActionProto();
          component.action(objectResponse);
          // TODO: Validate and add object to storage
          console.log("syncobjectreceived", objectResponse);
          break;
        case ActionProto.BatchResponseProto: {
          tracer.addTag(span, "msg_type", "AckResponseProto");
          const batchResponse = new BatchResponseProto();
          component.action(batchResponse);
          this.events.emit("batch-response", {
            actionId,
            success: batchResponse.success(),
          });
          break;
        }
        default:
          console.warn(`No handler for rx action type: ${actionType}:`);
      }
      tracer.endSpan(span);
    }
  }
}
