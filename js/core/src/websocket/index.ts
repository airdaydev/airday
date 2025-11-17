import { ByteBuffer } from "flatbuffers";
import {
  MessageWrapperProto,
  AuthenticateResponseProto,
  LibrarySyncResponseProto,
  MessageProto,
  BatchResponseProto,
  BatchSyncOpProto,
  OpKind,
} from "../proto";
import { AuthMode, Library, type AirdayCore } from "../core";
import { AuthenticateAction, BatchSyncMessage } from "../sync/fb";
import { stringify } from "uuid";
import { Uuidv4 } from "../common/uuid";
import { EventEmitter } from "../common/events";
import { spanFromFlatbuffer, tracer } from "../tracer";
import { ULSpan } from "@airday/tracer";
import { SyncOp } from "../sync/sync-op";
import { StreamContext } from "../sync/stream";

export interface OpResponse {
  opId: Uuidv4;
  success: boolean;
  seq?: bigint; // TODO
  error?: string;
}

interface WSEventMap {
  authenticated: { userId: Uuidv4; libraryId: Uuidv4 };
  ["op-response"]: OpResponse;
  ["sync-op"]: SyncOp;
  ["stream-event"]: StreamContext;
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
  intervalId: ReturnType<typeof setTimeout> | null = null;
  maxWSBatch = 10; // max ws messages
  maxOpBatch = 500; // Messages to send at once
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
  outboundMessages() {
    return this.outgoing.length > 0 || this.core.sync.outbox.length > 0;
  }
  get overflowed() {
    if (!this.ws) return true;
    return this.ws.bufferedAmount > this.maxBufferedAmount;
  }
  // TODO: This forms a batch of queued messages, then deals with ops
  // TBH we probably don't need to batch any other kind of message and can fuck half of this off
  next() {
    if (!this.authorised || !this.outboundMessages() || this.overflowed) {
      return;
    }
    // 2. Form batch
    const batch: QueuedMessage[] = [];
    while (this.outgoing.length > 0 && batch.length < this.maxWSBatch) {
      const item = this.outgoing[0];
      this.outgoing.shift();
      batch.push(item);
    }
    if (this.maxOpBatch > 0) {
      const ops = this.core.sync.takeOps(this.maxOpBatch);
      const message = new BatchSyncMessage(ops);
      // TODO: Is The QueuedMessage vs MQMessages still needed?
      const queuedMessage: QueuedMessage = {
        message,
      };
      batch.push(queuedMessage);
    }
    console.log("sending batch", batch.length);
    batch.map((item) => {
      this.send(item.message.serialise());
    });
    if (!this.outboundMessages()) {
      this.events.emit("flushed", {});
      this.stop(); // stop until we start again
    }
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
    this.intervalId = setInterval(() => this.next(), 1);
  }
  flush() {
    return new Promise((resolve) => {
      if (!this.outboundMessages()) resolve(null);
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
        }
        break;
      }
      case MessageProto.BatchSyncOpProto: {
        const msg = new BatchSyncOpProto();
        wrapper.message(msg);
        this.processBatchSyncOpMessage(span, msg);
      }
      case MessageProto.BatchResponseProto: {
        const msg = new BatchResponseProto();
        wrapper.message(msg);
        this.processBatchResponseMessage(span, msg);
      }
    }
  }
  // Confirmation message of locally generated sync, necessary in the case of a failure
  private processBatchResponseMessage(span: ULSpan, msg: BatchResponseProto) {
    for (let i = 0; i < msg.batchLength(); i++) {
      const res = msg.batch(i);
      if (!res) continue;
      const opId = Uuidv4.fromFBProto(res.opId());
      tracer.addTag(span, "msg_type", "ResponseProto");
      const seq = res.seq();
      // TODO: IMPORTANT Prevent if !success
      this.events.emit("op-response", {
        opId,
        success: res.success(), // TODO: We need an already commmitted case!
        seq,
      });
      tracer.endSpan(span);
    }
  }
  // Incoming sync update
  private processBatchSyncOpMessage(span: ULSpan, msg: BatchSyncOpProto) {
    const streamContextProto = msg.streamContext();
    let streamContext: StreamContext | null = null;
    if (streamContextProto) {
      let streamId = streamContextProto.id();
      if (streamId) {
        streamContext = {
          id: Uuidv4.fromFBProto(streamId),
          event: streamContextProto.event(),
        };
      }
    }
    for (let i = 0; i < msg.batchLength(); i++) {
      const op = msg.batch(i);
      if (!op) continue;
      // TODO: Decrypt payload
      // const payload = op.payload();
      const syncOpParams = {
        id: Uuidv4.fromFBProto(op.opId()),
        opKind: op.opKind(),
        libraryId: Uuidv4.fromFBProto(op.libraryId()),
        objId: Uuidv4.fromFBProto(op.objId()),
        objKind: op.objKind(),
        // payload
      };
      const syncOp = new SyncOp(syncOpParams);
      this.events.emit("sync-op", syncOp);
      // TODO: deal with op (patch/snapshot/delete)
      tracer.addTag(span, "msg_type", "SyncOpProto");
      tracer.endSpan(span);
    }
    if (streamContext) {
      this.events.emit("stream-event", streamContext);
    }
  }
}
