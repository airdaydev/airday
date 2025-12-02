import { EventEmitter } from "../common/events";
import { HexUuid, Uuidv4 } from "../common/uuid";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { OpResponse } from "../websocket";
import { SyncOp } from "./sync-op";
import { ChecksumStore } from "./checksum";
import { parseStreamCtx, StreamContext, SyncStream } from "./stream";
import { SyncObject } from "./sync-object";
import { ULSpan } from "@airday/tracer";
import {
  BatchResponseProto,
  BatchSyncOpProto,
  LibrarySyncResponseProto,
  MessageProto,
  MessageWrapperProto,
} from "../proto";
import { spanFromFlatbuffer, tracer } from "../tracer";

interface SyncEventMap {
  flushed: {};
}

// TODO: Streams should disappear on completion
// TODO: Ack timeouts...?
// TODO: Failure thresholds + offline!!!
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
  async initialise() {
    // 1. Attempt to load storage FOR CURRENT USER
    // // (retrieve by session key... - uh oh time to put some extra info in there?! and also have a purely offline user!)
    // 2. If user cache not present, leave in this state
    // 2. If no user present, start a new local library FRESH
  }
  initialSync() {
    // TODO: Prevent if not authorised
    this.getLibraries(); // TODO: currently a noop
    this.catchup(this.core.auth.sessionData!.primaryLibraryId, 0);
    // TODO: For each shared library, start list & item streams
    // TODO: Later, prioritise by active items, tombstoned items, completed items
    // TODO: Collect pending items, containers, libraries for pushing
  }
  applyLocal(patches: SyncObject[]) {
    for (let patch of patches) {
    }
    // this.core.storage.getById
    // 1. Find & merge object (checking cache first, then persistent layer), allowing UI to react
    // 2. Transaction of
    // -- persist merged object with hash
    // -- persist patch in outbox
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
  handleStreamEvent = (streamContext: StreamContext) => {
    const stream = this.streams.get(streamContext.id.toHex());
    if (stream) {
      stream.end();
    }
  };
  // TODO: This is obviously set up to persist in at least op id batches but clearly isn't here
  // TODO: This is a bit of a mess
  handleOpBatch = async (batch: SyncOp[]) => {
    const objIdMap = new Map<string, SyncOp[]>();
    batch.map((op) => {
      const id = op.id.toHex();
      const arr = objIdMap.get(id);
      if (arr) {
        arr.push(op);
      } else {
        objIdMap.set(id, [op]);
      }
    });
    // commit patches in batches (TODO: ideally persisting to idb in batches!)
    for (let key of objIdMap.keys()) {
      let obj: SyncObject | undefined;
      try {
        obj = await this.core.storage.getObj(Uuidv4.fromHex(key));
      } catch (err) {
        // Nothing
      }
      const arr = objIdMap.get(key);
      if (obj && arr) {
        arr.map((op) => {
          obj!.commitPatch(op);
        });
        // Persist objects (with op headers)
        console.log("persisterised");
        await this.core.storage.adapter.updateObject(obj);
        console.log("persisted");
      } else {
        console.log("no obj found!");
        const firstOp = arr!.shift();
        if (firstOp) {
          obj = new SyncObject(firstOp);
          arr!.map((op) => obj?.commitPatch(op));
          await this.core.storage.adapter.updateObject(obj);
        }
      }
    }
  };
  // Handler for a reply to an op originating from this client
  private processOpResponse = async (res: OpResponse) => {
    // TODO: Ensure:
    // - Optimistic in-memory
    // - Optimistic persisted (in a tx with op outbox)
    // TODO: Consider batching at this point (otherwise batch on storage...?)
    try {
      const op = await this.core.storage.adapter.getOutboxOp(res.opId);
      const obj = await this.core.storage.getObj(op.objId);
      // console.log("handling op response", res.seq, obj.id);
      // Phase 2 commit: commit & persist seq
      if (typeof res.seq == "bigint") {
        obj.setMaxSeq(res.seq); // ! TODO: Optional reactivity on seq itself or other metadata?
      }
      obj.commitPatch(op);
      await this.core.storage.adapter.deleteOutboxOp(op.id); // Job is done
      this.pendingOps.delete(op.id.toHex());
      // TODO: This update may be best done in a tx - unless it doesn't really matter due to having all relevant op headers
      await this.core.storage.adapter.updateObject(obj); // PERSIST CHANGE!
    } catch (err) {
      console.error(err, `Error retrieving opId`, res.opId);
    }
    if (!this.pendingOps.size) {
      this.events.emit("flushed", {});
    }
  };
  // Confirmation message of locally generated sync, necessary in the case of a failure
  private processBatchResponse(span: ULSpan, msg: BatchResponseProto) {
    for (let i = 0; i < msg.batchLength(); i++) {
      const res = msg.batch(i);
      if (!res) continue;
      const opId = Uuidv4.fromFBProto(res.opId());
      tracer.addTag(span, "msg_type", "ResponseProto");
      const seq = res.seq();
      // TODO: IMPORTANT Prevent if !success
      // this.events.emit("op-response", {
      //   opId,
      //   success: res.success(), // TODO: We need an already commmitted case!
      //   seq,
      // });
      tracer.endSpan(span);
    }
  }
  // Incoming sync update
  private processBatchSyncOp(span: ULSpan, msg: BatchSyncOpProto) {
    const streamContext = parseStreamCtx(msg.streamContext());
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
    // this.events.emit("sync-op-batch", incomingOps);

    if (streamContext) {
      // TODO: This should include stats
      // this.events.emit("stream-event", streamContext);
    }
  }
}

export async function* parseFrames(frames: AsyncIterable<MessageWrapperProto>) {
  for await (const wrapper of frames) {
    let span = spanFromFlatbuffer(wrapper.spanContext(), "ws:downstream");
    const type = wrapper.messageType();
    let msg: LibrarySyncResponseProto | BatchSyncOpProto | BatchResponseProto;
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
        throw new Error("Unknown message type");
      }
    }
    yield {
      type,
      span,
      msg,
    };
  }
}
