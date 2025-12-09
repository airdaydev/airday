import {
  MessageWrapperProto,
  AuthenticateResponseProto,
  MessageProto,
} from "../proto";
import { type AirdayCore } from "../core";
import { AuthenticateAction, BatchSyncMessage, decodeFrame } from "../sync/fb";
import { Uuidv4 } from "../common/uuid";
import { EventEmitter } from "../common/events";
import { spanFromFlatbuffer, tracer } from "../tracer";
import { ULSpan } from "@airday/tracer";
import { BearerAuth } from "../auth/bearer";

interface WSEventMap {
  end: {};
  authenticated: { userId: Uuidv4; libraryId: Uuidv4 };
  flushed: {};
}

export interface MQMessage {
  serialise(): Uint8Array;
}

export enum WSState {
  Disconnected,
  Connecting,
  Connected,
  Authorised,
}

// TODO: Offline considerations
export class WebsocketManager {
  readonly core: AirdayCore;
  readonly address: URL;
  events = new EventEmitter<WSEventMap>();
  state: WSState = WSState.Disconnected;
  // Outgoing queue
  intervalId: ReturnType<typeof setTimeout> | null = null;
  maxWSBatch = 10; // max ws messages
  maxOpBatch = 1000; // Messages to send at once
  maxBufferedAmount = 1024 * 1024; // 1MB
  outgoing: Array<MQMessage> = [];
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
    const address = core.apiUrl;
    address.pathname = "ws";
    this.address = address;
  }
  disrupt() {
    // Kills ws connection while allowing self-healing
    // Currently only used in tests
    this.ws?.close();
  }
  stop() {
    return new Promise((resolve) => {
      this.events.once("end", () => resolve(null));
      if (this.ac) {
        this.ac.abort();
      }
      if (!this.ws) resolve(null);
    });
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
    ws.addEventListener("open", () => {
      this.connectionAttempts = 0;
      this.state = WSState.Connected;
      if (this.core.auth instanceof BearerAuth) {
        this.bearerAuth();
      }
    });
    ws.addEventListener("message", (message: MessageEvent) => {
      console.log("decoding msg");
      const msg = decodeFrame(message);
      console.log("msg decoded:", msg?.messageType());
      if (msg?.messageType() === MessageProto.AuthenticateResponseProto) {
        let span = spanFromFlatbuffer(msg.spanContext(), "ws:downstream");
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
      throw new Error("ws.frames(): Cannot start second websocket connection");
    }
    console.debug(`WS connection attempt to ${this.address}`);
    // State
    const ws = this.connect();
    const self = this;
    let done = false;
    // Resilience or closing
    const close = (event: Event) => {
      const aborted = !this.ac || this.ac.signal.aborted;
      if (event.type === "error") {
        // TODO: how to trigger an error?
        console.error("ws:error", event.type);
      }
      this.state = WSState.Disconnected;
      this.ws = null;
      if (aborted) {
        this.events.emit("end", {});
        done = true;
        this.ac = null;
        if (this.pendingResolve) {
          this.pendingResolve({ value: undefined as any, done });
          this.pendingResolve = null;
        }
      } else {
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
    const auth = this.core.auth;
    if (auth instanceof BearerAuth && auth.sessionToken) {
      // TODO: Check expiry etc
      // Timeout for action completing?
      const msg = new AuthenticateAction(auth.sessionToken);
      this.ws.send(msg.serialise());
      msg.complete();
      return;
    }
    console.warn("Cannot websocket bearer auth, no bearer token");
    return;
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
    const sameUserId = this.core.auth.sessionData!.userId.equals(userId);
    const sameLibId =
      this.core.auth.sessionData!.primaryLibraryId.equals(libraryId);
    if (!sameUserId || !sameLibId) {
      // TODO: Consider this error
      throw new Error("Fatal error: user id / lib id swapped or non-existent");
    }
    this.state = WSState.Authorised;
    this.events.emit("authenticated", {
      userId,
      libraryId,
    });
  }
  // Explicit reconnect is useful for doing cookie authorisation
  reconnect() {}
  enqueue(message: MQMessage) {
    console.log("get enqueued");
    this.outgoing.push(message);
    this.startOutgoing();
  }
  outboundMessages() {
    return this.outgoing.length > 0 || this.core.sync.outbox.length > 0;
  }
  get overflowed() {
    if (!this.ws) return true;
    return this.ws.bufferedAmount > this.maxBufferedAmount;
  }
  next() {
    if (
      this.state !== WSState.Authorised ||
      !this.outboundMessages() ||
      this.overflowed
    ) {
      return;
    }
    // 2. Form batch
    const batch: MQMessage[] = [];
    while (this.outgoing.length > 0 && batch.length < this.maxWSBatch) {
      const item = this.outgoing[0];
      this.outgoing.shift();
      batch.push(item);
    }
    if (this.maxOpBatch > 0) {
      const msg = this.core.sync.getBatch(this.maxOpBatch);
      batch.push(msg);
    }
    batch.map((msg) => {
      this.send(msg.serialise());
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
}
