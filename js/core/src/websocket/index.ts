import { ByteBuffer } from "flatbuffers";
import {
  AddItemActionProto,
  AirdayActionProto,
  AirdayMessageProto,
  AuthenticateResponseProto,
  LibrarySyncResponseProto,
  AckResponseProto,
} from "../proto";
import { AuthMode, Library, type AirdayCore } from "../core";
import { AuthenticateAction, AirdayBatchMessage } from "../sync/actions";
import { stringify } from "uuid";
import { Uuidv4 } from "../uuid";
import { EventEmitter } from "./events";

interface WSEventMap {
  authenticated: { userId: Uuidv4; libraryId: Uuidv4 };
  ack: { actionId: Uuidv4; success: boolean; error?: string };
}

export enum Protocol {
  Airday = 0,
  JMAP = 1,
}

export interface MQMessage {
  toFlatBuffer(): Uint8Array;
}

export interface QueuedMessage {
  type: Protocol;
  message: MQMessage;
}

export interface AirdayQueuedMessage extends QueuedMessage {
  type: Protocol.Airday;
}

// TODO: Offline considerations
// TODO: Add time based flushing
export class WebsocketManager {
  core: AirdayCore;
  ws: WebSocket | null = null;
  address: URL;
  events = new EventEmitter<WSEventMap>();
  connected = false;
  authorised = false;
  // Queue
  running = false;
  maxBatch = 20; // Messages to send at once
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
      // TODO: Validate batch/extract span
      this.handleAirdayMessage(msg);
    }
  };
  enqueue(message: QueuedMessage) {
    this.outgoing.push(message);
    this.next();
  }
  enqueueAirdayMessage(message: MQMessage) {
    const queuedMessage: QueuedMessage = {
      type: Protocol.Airday,
      message,
    };
    this.enqueue(queuedMessage);
  }
  get overflowed() {
    if (!this.ws) return true;
    return this.ws.bufferedAmount > this.maxBufferedAmount;
  }
  next() {
    if (
      !this.running ||
      !this.authorised ||
      this.outgoing.length === 0 ||
      this.overflowed
    ) {
      return;
    }
    // 2. Form batch
    const batch: QueuedMessage[] = [];
    while (this.outgoing.length > 0 && batch.length < this.maxBatch) {
      const item = this.outgoing[0];
      this.outgoing.shift();
      if (item.type === Protocol.Airday) {
        batch.push(item);
      } else {
        // discard for now
      }
    }
    this.wsSend(batch);
    if (this.outgoing.length > 0) {
      this.next();
    }
  }
  async wsSend(batch: Array<QueuedMessage>) {
    batch.map((item) => {
      this.send(item.message.toFlatBuffer());
    });
  }
  stop() {
    this.running = false;
  }
  start() {
    this.running = true;
    this.next();
  }
  // TODO Consider moving this into subhandler
  private handleAirdayMessage(message: AirdayMessageProto) {
    console.log("RECEIVING A RESPONSE", message);
    if (!message) return;

    const batchLength = message.batchLength();
    for (let i = 0; i < batchLength; i++) {
      const component = message.batch(i);
      if (!component) continue;

      const actionType = component.actionType();

      switch (actionType) {
        // TODO: Make a generic success / ack response + match on msg id
        case AirdayActionProto.AuthenticateResponseProto:
          const authResponse = new AuthenticateResponseProto();
          component.action(authResponse);
          const userId = Uuidv4.fromFBVector(
            authResponse.userId.bind(authResponse),
          );
          const libraryId = Uuidv4.fromFBVector(
            authResponse.libraryId.bind(authResponse),
          );
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
        case AirdayActionProto.AddItemActionProto:
          const itemResponse = new AddItemActionProto();
          component.action(itemResponse);
          // TODO: Validate and add item to storage
          console.log(itemResponse.item());
          break;
        case AirdayActionProto.LibrarySyncResponseProto:
          const libraryResponse = new LibrarySyncResponseProto();
          component.action(libraryResponse);
          const primaryLibraryBuffer = libraryResponse.primaryLibrary();
          if (primaryLibraryBuffer) {
            // TODO: Validate and add item to storage
            let id = Uuidv4.fromFBVector(
              primaryLibraryBuffer.id.bind(primaryLibraryBuffer),
            );
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
          const ackResponse = new AckResponseProto();
          component.action(ackResponse);
          let actionId = Uuidv4.fromFBVector(
            ackResponse.messageId.bind(ackResponse),
          );
          this.events.emit("ack", {
            actionId,
            success: ackResponse.success(),
          });
          break;
        }
        default:
          console.warn(`No handler for rx action type: ${actionType}:`);
      }
    }
  }
}
