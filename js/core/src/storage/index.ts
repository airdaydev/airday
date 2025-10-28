// Memory storage for items (or all resources?)
import { EventEmitter } from "../common/events";
import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { SyncObject } from "../sync/sync-object";
import { StorageAdapter } from "./adapter";
import { AirdayIDBStorage } from "./idb";

interface StorageEventMap {
  upsert: { objects: SyncObject[] };
  delete: { ids: string[] };
}

// Fulfill example: Remote application of moving from one list to another
// Goal: Ensure the item is removed from one list & moved into another!
// Is this possible without going through every single list!?

// TODO: Boot cold items
export class AirdayStorage {
  core: AirdayCore;
  adapter: StorageAdapter;
  snapshotCache: Map<string, SyncObject> = new Map(); // hex-id-backed index
  events = new EventEmitter<StorageEventMap>();
  constructor(core: AirdayCore, adapter?: StorageAdapter) {
    this.core = core;
    this.adapter = adapter || new AirdayIDBStorage();
  }
  async removeItems(ids: Uuidv4[]) {
    ids.forEach((id) => this.snapshotCache.delete(id.toHex()));
    await this.adapter.delete(ids);
    // TODO: trigger subscription remove event!
  }
  // TODO: Trigger patch?
  subscribe() {
    // Ensure this happens in batches
  }
  setSyncObject(obj: SyncObject) {
    this.snapshotCache.set(obj.id.toHex(), obj);
  }
  getSyncObjectById(id: Uuidv4) {
    return this.snapshotCache.get(id.toHex());
  }
}
