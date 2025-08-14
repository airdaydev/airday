import { EventEmitter } from "../common/events";
import { Uuidv4 } from "../common/uuid";
import type { AirdayCore } from "../core";
import { globalTSProducer } from "../crdt/lww";
import { AirdayIDB } from "../storage/idb";
import { AckEvent } from "../websocket";
import { BatchAction, BatchSyncMessage, SyncItemAction } from "./actions";
import { ChecksumStore } from "./checksum";
import { AirdayItem } from "./model";
import { ItemSyncStream, SyncStream } from "./stream";

interface SyncEventMap {
  flushed: {};
}

// TODO: Streams should disappear on completion
// TODO: Ack timeouts...?
// TODO: Failure thresholds + offline!!!
export class AirdaySync {
  private idb: AirdayIDB | null = null;
  core: AirdayCore;
  pendingActions = new Map<string, BatchAction>(); // string = hex type
  events = new EventEmitter<SyncEventMap>();
  itemChecksum = new ChecksumStore();
  lastServerTimestamp: number | null = null;
  streams = new Map<string, SyncStream>();
  constructor(core: AirdayCore) {
    this.core = core;
    this.core.ws.events.on("ack", (ack) => this.handleAck(ack));
  }
  // Wait for pending acknowledgements
  flush() {
    return new Promise((resolve) => {
      if (this.pendingActions.size === 0) resolve(null);
      this.events.once("flushed", resolve);
    });
  }
  timestamp() {
    return globalTSProducer.timestamp();
  }
  // TODO: Use account
  setDB(idb: AirdayIDB) {
    this.idb = idb;
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
    const itemStream = new ItemSyncStream(this.core, libraryId);
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
  syncItems(items: AirdayItem[]) {
    // Filter out items currently in sync
    const actions = items
      .filter((item) => {
        return !item.syncStarted;
      })
      .map((item) => {
        item.startSync();
        const action = new SyncItemAction(item);
        // TODO: Ensure this works for updated items too
        this.idb?.item.upsert([item]); // optimistic update
        this.pendingActions.set(action.id.toHex(), action);
        return action;
      });
    const message = new BatchSyncMessage(actions);
    this.core.ws.enqueueAirdayMessage(message);
    return actions;
  }
  syncPendingItems() {
    // Collects pending items from database to sync on boot
  }
  deleteItem(id: String) {
    // TODO: Use the upsertItem api with tombstone timestamp
  }
  // TODO: Do we need ack + pending? vs retaining state on object itself?
  // Probably yes but just keep this todo here for a bit
  handleAck(ack: AckEvent) {
    const action = this.pendingActions.get(ack.actionId.toHex());

    if (action instanceof SyncItemAction) {
      // TODO: targeted change instead of blunt (pass in idb to endSync?)
      this.idb?.item.upsert([action.item]).catch((err) => {
        console.log(err);
      });
      this.pendingActions.delete(ack.actionId.toHex());
      action.item.endSync();
      if (this.pendingActions.size === 0) {
        // Consider renaming: no pending acknowledgements remaining
        this.events.emit("flushed", {});
      }
      // If item has changes applied during sync, sync them
      if (!action.item.isSynced()) {
        this.syncItems([action.item]);
      }
    }
    // TODO: More acks? e.g. list ack
  }
}
