import { EventEmitter } from "../common/events";
import { HexUuid, Uuidv4 } from "../common/uuid";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { SyncOp } from "./sync-op";
import { ChecksumStore } from "./checksum";
import { parseStreamCtx, StreamContext, SyncStream } from "./stream";
import { SyncObject } from "./sync-object";
import {
  BatchResponseProto,
  BatchSyncOpProto,
  ErrorResponseProto,
  LibrarySyncResponseProto,
  MessageProto,
  MessageWrapperProto,
  ResponseProto,
} from "../proto";
import { spanFromFlatbuffer, tracer } from "../tracer";
import { ULSpan } from "@airday/tracer";
import { AuthState } from "../auth/adapter";
import { BatchSyncMessage } from "./fb";

interface SyncEventMap {
  flushed: {};
}

export interface OpAck {
  opId: Uuidv4;
  seq: bigint;
}

export function parseResponseProto(proto: ResponseProto): OpAck {
  const opId = Uuidv4.fromFBProto(proto.opId());
  if (!proto.success()) {
    throw new Error(`Ack ${opId} failed with error: ${proto.error()}`);
  }
  return {
    opId,
    seq: proto.seq(),
  };
}

const enum SyncState {
  Stopped,
  Started,
  Stopping,
}

// TODO: Ack timeouts...?
export class AirdaySync {
  core: AirdayCore;
  syncState = SyncState.Stopped;
  outbox: SyncOp[] = []; // Ops ready to be pulled by ws
  pendingOps = new Map<HexUuid, SyncOp>(); // Ops handed off to websocket message already
  events = new EventEmitter<SyncEventMap>();
  itemChecksum = new ChecksumStore();
  lastServerSeq: number | null = null;
  streams = new Map<string, SyncStream>();
  snapshotLimit = 16; // Amount of ops to keep before we compact via snapshot
  constructor(core: AirdayCore) {
    this.core = core;
  }
  async start() {
    if (this.core.auth.state !== AuthState.Remote) {
      console.warn("attempted to startSync without credentials loaded");
      return;
    }
    // TODO: This should be embedded in sync state / ws state
    if (this.syncState !== SyncState.Stopped) {
      throw new Error("Sync already started");
    }
    this.syncState = SyncState.Started;
    try {
      const protoFrames = this.core.ws.frames();
      const parsedFrames = parseFrames(protoFrames);
      for await (const frame of parsedFrames) {
        await this.handleFrame(frame);
      }
    } catch (err) {
      console.error("startSync failed", err);
    }
    this.syncState = SyncState.Stopped;
  }
  // Stop but keep ingesting queued frames
  async stop() {
    this.syncState = SyncState.Stopping;
    await this.core.ws.stop();
  }
  // TODO: rename as this only awaits pending batch response completions
  // TODO: Timeout!
  flush() {
    return new Promise((resolve) => {
      // TODO: This should also test ws outbound messages
      if (this.pendingOps.size === 0) resolve(null);
      this.events.once("flushed", resolve);
    });
  }
  timestamp() {
    return globalTSProducer.timestamp();
  }
  getBatch(count: number) {
    return this.core.sync.outbox.splice(0, count);
  }
  initialSync() {
    // TODO: Prevent if not authorised
    this.getLibraries(); // TODO: currently a noop
    this.catchup(this.core.auth.sessionData!.primaryLibraryId);
    // TODO: For each shared library, start list & item streams
    // TODO: Later, prioritise by active items, tombstoned items, completed items
    // TODO: Collect pending items, containers, libraries for pushing
  }
  getLibraries() {
    console.log("hit getLibraries noop");
    // TODO: Get all shared libraries (TODO: Offline mode? Sync? limits?)
    // TODO: Process for creating a shared library
  }
  catchup(libraryId: Uuidv4, sinceSeq: bigint = 0n) {
    const itemStream = new SyncStream(libraryId, sinceSeq);
    const existingStream = this.streams.get(itemStream.key);
    if (existingStream && existingStream.syncing) {
      throw new Error(
        `Existing stream [key=${itemStream.key}] already running`,
      );
    }
    this.streams.set(itemStream.key, itemStream); // TODO: differentiate index
    this.streams.set(itemStream.id.toHex(), itemStream);
    const req = itemStream.req();
    this.core.ws.enqueue(req);
    return itemStream;
  }
  createList(list: any) {}
  async queueOp(op: SyncOp, obj: SyncObject) {
    await this.core.storage.adapter.addOp(op, obj);
    this.core.storage.setStateCache(obj);
    this.outbox.push(op);
    this.core.ws.startOutgoing();
    this.pendingOps.set(op.id.toHex(), op);
  }
  initOutbox() {
    // Collects pending items from database to sync on boot
  }
  deleteItem(id: String) {
    // TODO: Use the upsertItem api with tombstone timestamp
  }
  processStreamContext(streamContext: StreamContext) {
    const stream = this.streams.get(streamContext.id.toHex());
    if (!stream) {
      console.error(`Stream ${streamContext.id.toString()} not found`);
      return;
    }
    stream.processMessage(streamContext);
  }
  async handleFrame(frame: ParsedFrame) {
    // TODO: Do something with spans
    const { msg, span } = frame;
    // TODO: collect batches of each type or make new streams
    switch (msg.constructor) {
      case LibrarySyncResponseProto: {
        // this.handleOpBatch(message);
        break;
      }
      case BatchSyncOpProto: {
        const typed = msg as BatchSyncOpProto;
        const streamContext = parseStreamCtx(typed.streamContext());
        if (streamContext) {
          this.processStreamContext(streamContext);
        }
        // TODO: Process stream message
        for (let i = 0; i < typed.batchLength(); i++) {
          const rawOp = typed.batch(i);
          if (!rawOp) {
            console.warn("Encountered invalid raw op");
            continue;
          }
          const syncOp = SyncOp.fromSyncOpProto(rawOp);
          const obj = await this.applyRemote(syncOp);
          this.core.storage.objectDirty.add(obj.id);
        }
        break;
      }
      case BatchResponseProto: {
        const typed = msg as BatchResponseProto;
        for (let i = 0; i < typed.batchLength(); i++) {
          const rawAck = typed.batch(i);
          if (!rawAck) {
            console.warn("Encountered invalid rawAck");
            continue;
          }
          try {
            const ack = parseResponseProto(rawAck);
            const obj = await this.applyAck(ack);
            if (!obj) {
              console.warn(
                `No obj found for corresponding ack for op id ${ack.opId}`,
              );
              continue;
            }
            this.core.storage.objectDirty.add(obj.id);
            this.core.storage.outboxDirty.add(ack.opId);
          } catch (err) {
            console.error("Ack failed with error", err);
            continue;
          }
        }
        break;
      }
    }
  }
  // Handler for incoming remote sync operations
  applyRemote = async (syncOp: SyncOp) => {
    const obj = await this.core.storage.getObj(syncOp.objId);
    if (obj) {
      // Existing object found
      obj!.commitPatch(syncOp);
      return obj;
    }
    // New obj
    const newObj = new SyncObject(syncOp);
    this.core.storage.setStateCache(newObj);
    newObj?.commitPatch(syncOp);
    return newObj;
  };
  // Handler for a reply to an op originating from this client - 2nd phase commit
  private applyAck = async (ack: OpAck) => {
    const op = await this.core.storage.adapter.getOutboxOp(ack.opId);
    const obj = await this.core.storage.getObj(op.objId);
    if (obj) {
      obj.commitPatch(op);
      this.pendingOps.delete(op.id.toHex());
      console.log("this.pendingOps.size", this.pendingOps.size);
      if (!this.pendingOps.size) {
        this.events.emit("flushed", {});
      }
      return obj;
    } else {
      console.error(`Error retrieving opId`, ack.opId);
    }
  };
}

type IncomingMessage =
  | LibrarySyncResponseProto
  | BatchSyncOpProto
  | BatchResponseProto;

export type ParsedFrame = {
  msg: IncomingMessage;
  span: ULSpan;
};

export async function* parseFrames(frames: AsyncIterable<MessageWrapperProto>) {
  for await (const wrapper of frames) {
    let span = spanFromFlatbuffer(wrapper.spanContext(), "ws:downstream");
    const type = wrapper.messageType();
    let msg: IncomingMessage;
    switch (type) {
      case MessageProto.LibrarySyncResponseProto: {
        msg = new LibrarySyncResponseProto();
        tracer.addTag(span, "proto_type", "library_sync_response_proto");
        wrapper.message(msg);
        break;
      }
      case MessageProto.BatchSyncOpProto: {
        msg = new BatchSyncOpProto();
        tracer.addTag(span, "proto_type", "batch_sync_op_proto");
        wrapper.message(msg);
        break;
      }
      case MessageProto.BatchResponseProto: {
        msg = new BatchResponseProto();
        tracer.addTag(span, "proto_type", "batch_response_proto");
        wrapper.message(msg);
        break;
      }
      case MessageProto.ErrorResponseProto: {
        const error = new ErrorResponseProto();
        tracer.addTag(span, "proto_type", "error_response_proto");
        wrapper.message(error);
        console.error("ErrorResponseProto:", error.error());
        continue;
      }
      default: {
        // log error
        tracer.endSpan(span);
        throw new Error(
          `Unknown message type ${type} ${MessageProto.ErrorResponseProto}`,
        );
      }
    }
    yield {
      span,
      msg,
    } satisfies ParsedFrame;
  }
}
