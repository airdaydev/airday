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
  LibrarySyncResponseProto,
  MessageProto,
  MessageWrapperProto,
  ResponseProto,
} from "../proto";
import { spanFromFlatbuffer, tracer } from "../tracer";
import { ULSpan } from "@airday/tracer";

interface SyncEventMap {
  flushed: {};
}

export interface OpAck {
  opId: Uuidv4;
  seq: bigint;
}

export function parseResponseProto(proto: ResponseProto): OpAck {
  if (!proto.success()) {
    throw new Error(`Ack failed with error: ${proto.error()}`);
  }
  return {
    opId: Uuidv4.fromFBProto(proto.opId()),
    seq: proto.seq(),
  };
}

// TODO: Ack timeouts...?
export class AirdaySync {
  core: AirdayCore;
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
  takeOps(count: number) {
    return this.core.sync.outbox.splice(0, count);
  }
  initialSync() {
    // TODO: Prevent if not authorised
    this.getLibraries(); // TODO: currently a noop
    this.catchup(this.core.auth.sessionData!.primaryLibraryId, 0);
    // TODO: For each shared library, start list & item streams
    // TODO: Later, prioritise by active items, tombstoned items, completed items
    // TODO: Collect pending items, containers, libraries for pushing
  }
  getLibraries() {
    console.log("hit getLibraries noop");
    // TODO: Get all shared libraries (TODO: Offline mode? Sync? limits?)
    // TODO: Process for creating a shared library
  }
  catchup(libraryId: Uuidv4, sinceSeq: number) {
    const itemStream = new SyncStream(this.core, libraryId);
    const existingStream = this.streams.get(itemStream.key);
    if (existingStream && existingStream.syncing) {
      console.warn(`Existing stream [key=${itemStream.key}] already running`);
      return existingStream; // TODO: this is not it
    }
    this.streams.set(itemStream.key, itemStream); // TODO: differentiate index
    this.streams.set(itemStream.id.toHex(), itemStream);
    itemStream.start(null);
    return itemStream;
  }
  createList(list: any) {}
  async queueOp(op: SyncOp, obj: SyncObject) {
    await this.core.storage.adapter.addOp(op, obj);
    this.core.storage.setStateCache(obj);
    this.outbox.push(op);
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
    if (!stream) return;
    stream.processMessage(streamContext);
  }
  async handleFrame(frame: ParsedFrame) {
    // TODO: Do something with spans
    const { msg, span } = frame;
    // TODO: collect batches of each type or make new streams
    switch (Object.getPrototypeOf(msg)) {
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
          if (!rawAck.success()) {
            console.warn("Ack failure", rawAck.opId());
          }
          try {
            const ack = parseResponseProto(rawAck);
            const obj = await this.applyAck(ack);
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
  handleStreamEvent = (streamContext: StreamContext) => {
    const stream = this.streams.get(streamContext.id.toHex());
    if (stream) {
      stream.end();
    }
  };
  // For incoming remote sync operations,
  // we create or apply ops to the corresponding cached obj
  // then return a set - marking them for persistence
  // TODO Actually we gain nothing doing this in bulk
  applyRemote = async (syncOp: SyncOp) => {
    try {
      // Existing object found
      const obj = await this.core.storage.getObj(syncOp.objId);
      obj!.commitPatch(syncOp);
      return obj;
    } catch (err) {
      // New object, set immediately but do not persist
      const obj = new SyncObject(syncOp);
      this.core.storage.setStateCache(obj);
      obj?.commitPatch(syncOp);
      return obj;
    }
  };
  // Handler for a reply to an op originating from this client (2nd phase commit)
  private applyAck = async (ack: OpAck) => {
    try {
      const op = await this.core.storage.adapter.getOutboxOp(ack.opId);
      const obj = await this.core.storage.getObj(op.objId);
      obj.setMaxSeq(ack.seq);
      obj.commitPatch(op);
      this.pendingOps.delete(op.id.toHex());
    } catch (err) {
      console.error(err, `Error retrieving opId`, res.opId);
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
      default: {
        // log error
        tracer.endSpan(span);
        throw new Error("Unknown message type");
      }
    }
    yield {
      span,
      msg,
    } satisfies ParsedFrame;
  }
}
