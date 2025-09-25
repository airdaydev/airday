import { EventEmitter } from "../common/events";
import { HexUuid, Uuidv4 } from "../common/uuid";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { BatchResponseEvent } from "../websocket";
import { BatchAction, BatchSyncMessage, SyncOp } from "./fb";
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
  outbox = new Map<HexUuid, BatchAction>(); // Queued, in-flight or failed messages
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
  // TODO: Pluralise this and we can call it when a list has been synced
  // TODO: Error handling?
  async queueOps(ops: SyncOp[]) {
    for (let op of ops) {
      // TODO: Outbox + upsert as a transaction
      // Cleaner to await, but we don't really need to
      this.core.storage.idb.upsert([op.syncObject]); // optimistic update
      this.outbox.set(op.id.toHex(), op);
    }
    const message = new BatchSyncMessage(ops);
    this.core.ws.enqueueAirdayMessage(message);
  }
  initOutbox() {
    // Collects pending items from database to sync on boot
  }
  deleteItem(id: String) {
    // TODO: Use the upsertItem api with tombstone timestamp
  }
  // TODO: Do we need ack + pending? vs retaining state on object itself?
  // Probably yes but just keep this todo here for a bit
  handleBatchResponse = (res: BatchResponseEvent) => {
    const action = this.outbox.get(res.actionId.toHex());

    if (action instanceof SyncOp) {
      if (res.success) {
        // TODO: Maybe separate success message is a good thing!
        // if (res.seq) {
        //   action.syncObject.seq = res.seq;
        // }
        // TODO: targeted change instead of blunt (pass in idb to endSync?)
        this.core.storage.idb?.upsert([action.syncObject]).catch((err) => {
          console.log(err);
        });
        this.outbox.delete(res.actionId.toHex());
        if (this.outbox.size === 0) {
          // Consider renaming: no pending acknowledgements remaining
          this.events.emit("flushed", {});
        }
      }
    } else {
      console.error("Failed to sync item", res.error);
      // Failure!
      // TODO: Retries!
    }
    // TODO: Other resource types
  };
}
