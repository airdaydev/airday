import { EventEmitter } from "../common/events";
import { HexUuid, Uuidv4 } from "../common/uuid";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { BatchResponseEvent } from "../websocket";
import { BatchSyncMessage } from "./fb";
import { SyncOp } from "./sync-op";
import { ChecksumStore } from "./checksum";
import { SyncStream } from "./stream";
import { SyncObject } from "./sync-object";

interface SyncEventMap {
  flushed: {};
}

// TODO: Streams should disappear on completion
// TODO: Ack timeouts...?
// TODO: Failure thresholds + offline!!!
export class AirdaySync {
  core: AirdayCore;
  outbox = new Map<HexUuid, SyncOp>(); // Queued, in-flight or failed messages
  events = new EventEmitter<SyncEventMap>();
  itemChecksum = new ChecksumStore();
  lastServerSeq: number | null = null;
  streams = new Map<string, SyncStream>();
  constructor(core: AirdayCore) {
    this.core = core;
    this.core.ws.events.on("batch-response", this.handleBatchResponse);
  }
  // TODO: rename as this only awaits pending batch response completions
  // TODO: Timeout!
  flush() {
    return new Promise((resolve) => {
      if (this.outbox.size === 0) resolve(null);
      this.events.once("flushed", resolve);
    });
  }
  timestamp() {
    return globalTSProducer.timestamp();
  }
  // To be run after login
  initialSync() {
    // TODO: Prevent if not authorised
    this.streamItems(this.core.library.id!);
    this.streamContainers(this.core.library.id!); // TODO: Currently a noop
    this.getLibraries(); // TODO: currently a noop
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
  streamContainers(libraryId: Uuidv4) {
    console.log("hit streamContainers noop");
    // i.e. lists
  }
  streamItems(libraryId: Uuidv4) {
    const itemStream = new SyncStream(this.core, libraryId);
    const existingStream = this.streams.get(itemStream.key);
    if (existingStream && existingStream.syncing) {
      console.warn(`Existing stream [key=${itemStream.key}] already running`);
      return;
    }
    this.streams.set(itemStream.key, itemStream);
    itemStream.start(null);
  }
  createList(list: any) {}
  async queueOp(op: SyncOp, obj: SyncObject) {
    await this.core.storage.adapter.addOp(op, obj);
    this.core.storage.setStateCache(obj);
    this.outbox.set(op.id.toHex(), op);
    // TODO: Not really batching huh...
    const message = new BatchSyncMessage([op]);
    this.core.ws.enqueueAirdayMessage(message);
  }
  initOutbox() {
    // Collects pending items from database to sync on boot
  }
  deleteItem(id: String) {
    // TODO: Use the upsertItem api with tombstone timestamp
  }
  handleBatchResponse = (res: BatchResponseEvent) => {
    // TODO: Ensure:
    // - Optimistic in-memory
    // - Optimistic persisted (in a tx with op outbox)
    // TODO: Consider putting in queue
    this.core.storage.adapter
      .getOutboxOp(res.opId)
      .then(async (op) => {
        console.log(op.opKind); // TODO: Consider deletes/snapshots!
        const obj = await this.core.storage.getObj(op.objId);
        // Phase 2 commit: commit & persist seq
        obj.seq = res.seq!; // ! TODO: Optional reactivity?
        obj.commitPatch(op);
        await this.core.storage.adapter.deleteOutboxOp(op.id); // Job is done
        // TODO: delete pending op!
        // TODO: This update may be best done in a tx - unless it doesn't really matter due to having all relevant op headers
        await this.core.storage.adapter.updateObject(obj);
        // TODO: The case for saving op headers on the object: idempotency on hashes
      })
      .catch((err) => {
        console.error(`Error retrieving opId`, opId);
      });

    // op persisted locally, state computed & persisted for fast access
    // op persisted to server, returning seq
    // seq stored against persisted version (so this is really last_seq)
    // seq is fairly reliable, and if a seq is missed, it can be picked up by a merkle-tree based on the latest hash (computed only on ops with seqs)
    // SO: Keep current-snapshot op headers on client
    // OR if user wants to keep history - they can if there is room (but this is an optional/advanced option)
    // hash is calculated on ops with seq only
    //
    // problem: ops contributing to fast access state, that did not have a seq, then being lost would then show a valid hash while the object would be invalid!
    // solution = 2-phase state
    // commmitted + optimistic separately
    //
    //
    // TODO: We need to update in-memory version & db version (reactivity + persistence)
    console.log("sync res received", seq);
  };
}
