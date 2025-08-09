import { ByteBuffer } from "flatbuffers";
import {
  UpsertItemActionProto,
  AirdayActionProto,
  AirdayMessageProto,
  AuthenticateResponseProto,
  LibrarySyncResponseProto,
  AckResponseProto,
} from "../proto";
import { AuthMode, Library, type AirdayCore } from "../core";
import { AuthenticateAction, AirdayBatchMessage } from "../sync/actions";
import { stringify } from "uuid";
import { Uuidv4 } from "../common/uuid";
import { EventEmitter } from "../common/events";
import { spanFromFlatbuffer, tracer } from "../tracer";
import { ULSpan } from "@airday/tracer";

export interface AckEvent {
  actionId: Uuidv4;
  success: boolean;
  error?: string;
}

interface WSEventMap {
  authenticated: { userId: Uuidv4; libraryId: Uuidv4 };
  ack: AckEvent;
  flushed: {};
}

export interface MQMessage {
  toFlatBuffer(): Uint8Array;
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
    const action = new AuthenticateAction(this.core.session.token);
    const msg = new AirdayBatchMessage([action]);
    console.debug("WS: Sending", msg.actions.length, "action");
    this.ws.send(msg.toFlatBuffer());
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
      const msg = AirdayMessageProto.getRootAsAirdayMessageProto(bb);
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
      this.send(item.message.toFlatBuffer());
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
  private handleAirdayMessage(span: ULSpan, message: AirdayMessageProto) {
    if (!message) return;

    const batchLength = message.batchLength();
    for (let i = 0; i < batchLength; i++) {
      const component = message.batch(i);
      if (!component) continue;

      const actionType = component.actionType();

      switch (actionType) {
        // TODO: Make a generic success / ack response + match on msg id
        case AirdayActionProto.AuthenticateResponseProto:
          tracer.addTag(span, "msg_type", "AuthenticateResponseProto");
          const authResponse = new AuthenticateResponseProto();
          component.action(authResponse);
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
          // TODO: We need a means for the sync batcher to continue
          break;
        case AirdayActionProto.UpsertItemActionProto:
          tracer.addTag(span, "msg_type", "UpsertItemActionProto");
          const itemResponse = new UpsertItemActionProto();
          component.action(itemResponse);
          // TODO: Validate and add item to storage
          console.log(itemResponse.item());
          break;
        case AirdayActionProto.LibrarySyncResponseProto:
          tracer.addTag(span, "msg_type", "LibrarySyncResponseProto");
          const libraryResponse = new LibrarySyncResponseProto();
          component.action(libraryResponse);
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
        case AirdayActionProto.AckResponseProto: {
          tracer.addTag(span, "msg_type", "AckResponseProto");
          const ackResponse = new AckResponseProto();
          component.action(ackResponse);
          let actionId = Uuidv4.fromFBProto(ackResponse.messageId());
          this.events.emit("ack", {
            actionId,
            success: ackResponse.success(),
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
