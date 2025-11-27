import {
  MessageWrapperProto,
  AuthenticateResponseProto,
  LibrarySyncResponseProto,
  MessageProto,
  BatchResponseProto,
  BatchSyncOpProto,
} from "../proto";
import { type AirdayCore } from "../core";
import { AuthenticateAction, BatchSyncMessage, decodeFrame } from "../sync/fb";
import { stringify } from "uuid";
import { Uuidv4 } from "../common/uuid";
import { EventEmitter } from "../common/events";
import { spanFromFlatbuffer, tracer } from "../tracer";
import { ULSpan } from "@airday/tracer";
import { SyncOp } from "../sync/sync-op";
import { StreamContext } from "../sync/stream";
import { Library } from "../common/library";

export interface OpResponse {
  opId: Uuidv4;
  success: boolean;
  seq?: bigint;
  error?: string;
}

interface WSEventMap {
  authenticated: { userId: Uuidv4; libraryId: Uuidv4 };
  ["op-response"]: OpResponse;
  ["sync-op-batch"]: SyncOp[];
  ["stream-event"]: StreamContext;
  flushed: {};
}

type RawFrame = ArrayBuffer;

export interface MQMessage {
  serialise(): Uint8Array;
}

export interface QueuedMessage {
  message: MQMessage;
}

export enum WSState {
  Disconnected,
  Connecting,
  Connected,
  Authorised,
}

// TODO: Offline considerations
export class WebsocketManager {
  core: AirdayCore;
  address: URL;
  events = new EventEmitter<WSEventMap>();
  state: WSState = WSState.Disconnected;
  // Outgoing queue
  intervalId: ReturnType<typeof setTimeout> | null = null;
  maxWSBatch = 10; // max ws messages
  maxOpBatch = 1000; // Messages to send at once
  maxBufferedAmount = 1024 * 1024; // 1MB
  outgoing: Array<QueuedMessage> = [];
  // Conn & incoming msg iterator
  private connectionAttempts = 0;
  private ws: WebSocket | null = null;
  private pendingResolve:
    | ((r: IteratorResult<MessageWrapperProto>) => void)
    | null = null;
  private buffer: MessageWrapperProto[] = [];
  private ac: AbortController | null = new AbortController();
  // --
  constructor(core: AirdayCore) {
    this.core = core;
    const address = core.root;
    address.pathname = "ws";
    this.address = address;
  }
  disrupt() {
    // Kills ws connection while allowing self-healing
    // Currently only used in tests
    this.ws?.close();
  }
  stop() {
    if (this.ac) this.ac.abort();
  }
  // connect with retries
  private connect() {
    if (this.ws) {
      throw new Error("attempting to open concurrent ws connections");
    }
    // TODO: Attempts + back off
    // console.log("retrying", this.connectionAttempts);
    this.connectionAttempts++;
    this.ac = new AbortController();
    const ws = new WebSocket(this.address);
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", (event) => {
      this.connectionAttempts = 0;
      this.state = WSState.Connected;
      if (this.core.authMode === AuthMode.BearerToken) {
        this.bearerAuth();
      }
      // TODO: Re. cookie auth... send same message on server to ensure core is authorised
    });
    ws.addEventListener("message", (message: MessageEvent) => {
      const msg = decodeFrame(message);
      let span;
      if (msg) {
        // TODO: Do something with span, here?
        span = spanFromFlatbuffer(msg.spanContext(), "ws:downstream");
      }
      if (msg?.messageType() === MessageProto.AuthenticateResponseProto) {
        const authResponse = new AuthenticateResponseProto();
        msg.message(authResponse);
        this.handleAuthResponse(span, authResponse);
      } else if (msg) {
        if (this.pendingResolve) {
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          resolve({ value: msg, done: false });
        } else {
          this.buffer.push(msg);
        }
      }
    });
    return ws;
  }
  // Message handler & producer
  frames(): AsyncIterable<MessageWrapperProto> {
    if (this.ws) {
      // TODO: Consider separating connect & producer so frames producer can be reused
      throw new Error("Cannot call ws.frames() twice.");
    }
    console.debug(`WS connection attempt to ${this.address}`);
    // State
    const ws = this.connect();
    const self = this;
    let done = false;
    // Resilience or closing
    const close = (event: Event) => {
      // TODO: Reconsider abort controller negation here
      // - if it doesn't exist it should have already aborted
      const aborted = !this.ac || this.ac.signal.aborted;
      if (event.type === "error") {
        // TODO: how to trigger an error?
        console.error("ws:error", event.type);
      }
      this.state = WSState.Disconnected;
      this.ws = null;
      if (aborted) {
        done = true;
      }
      if (this.pendingResolve && aborted) {
        this.pendingResolve({ value: undefined as any, done });
        this.pendingResolve = null;
        this.ac = null;
      }
      if (!aborted && !this.ws) {
        this.connect();
      }
    };
    ws.addEventListener("close", close);
    ws.addEventListener("error", (err) => close(err));
    // Iteration
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<MessageWrapperProto>> {
            if (self.buffer.length > 0) {
              const value = self.buffer.shift()!;
              return Promise.resolve({ value: value, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined as any, done: true });
            }
            return new Promise<IteratorResult<MessageWrapperProto>>(
              (resolve) => {
                self.pendingResolve = resolve;
              },
            );
          },
        };
      },
    };
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
  handleAuthResponse(span: ULSpan | undefined, res: AuthenticateResponseProto) {
    if (span) {
      // TODO: Perhaps we should create an empty span
      tracer.addTag(span, "msg_type", "AuthenticateResponseProto");
    }
    const userId = Uuidv4.fromFBProto(res.userId());
    const libraryId = Uuidv4.fromFBProto(res.libraryId());
    // Confirm things make sense and authorise
    // TODO: Confirm library id valid
    const authorised = this.core.session?.userId === stringify(userId);
    this.state = WSState.Authorised;
    this.core.library.id = libraryId; // TODO: Handle previous library/store?
    if (!authorised) {
      console.warn(this.core.session?.userId, stringify(userId), "huh");
    } else {
      this.events.emit("authenticated", {
        userId,
        libraryId,
      });
    }
  }
  // Explicit reconnect is useful for doing cookie authorisation
  reconnect() {}
  enqueue(message: QueuedMessage) {
    this.outgoing.push(message);
    this.startOutgoing();
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
    console.log(this.state);
    if (
      this.state !== WSState.Authorised ||
      !this.outboundMessages() ||
      this.overflowed
    ) {
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
      this.stopOutgoing(); // stop until we start again (this won't start again if there's no new ops coming in)
    }
  }
  private stopOutgoing() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    this.intervalId = null;
  }
  private startOutgoing() {
    if (this.intervalId) return; // Do nothing if interval is already going
    this.intervalId = setInterval(() => this.next(), 50);
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
        // TODO: Consider "auth" notification using JS native events
        this.startOutgoing();
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
            primary: true,
            remote: true,
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
    const incomingOps: SyncOp[] = [];
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
      incomingOps.push(syncOp);
      // TODO: Denormalise queues
      // TODO: deal with op (patch/snapshot/delete)
      tracer.addTag(span, "msg_type", "SyncOpProto");
      tracer.endSpan(span);
    }
    this.events.emit("sync-op-batch", incomingOps);

    if (streamContext) {
      // TODO: This should include stats
      this.events.emit("stream-event", streamContext);
    }
  }
}
