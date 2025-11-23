// Memory storage for items (or all resources?)
import { EventEmitter } from "../common/events";
import { Library } from "../common/library";
import {
  HexUuid,
  LibraryHexUuid,
  SyncObjectHexUuid,
  Uuidv4,
} from "../common/uuid";
import { AirdayCore } from "../core";
import { SyncObject } from "../sync/sync-object";
import { SyncOp } from "../sync/sync-op";
import { StorageAdapter } from "./adapter";
import { AirdayIDBStorage } from "./idb";

interface StorageEventMap {
  upsert: { objects: SyncObject[] };
  delete: { ids: string[] };
}

export class AirdayStorage {
  core: AirdayCore;
  adapter: StorageAdapter;
  // Libraries
  // OpCache
  stateCache: Map<SyncObjectHexUuid, SyncObject> = new Map();
  opLibMap: Map<LibraryHexUuid, SyncObjectHexUuid> = new Map();
  outbox: Map<HexUuid, SyncOp> = new Map();
  // Reactivity
  events = new EventEmitter<StorageEventMap>();
  constructor(core: AirdayCore, adapter?: StorageAdapter) {
    this.core = core;
    this.adapter = adapter || new AirdayIDBStorage();
  }
  async initialise() {
    // 1. Attempt to load storage BY USER
    // 2. If user cache not present, leave in this state
    // 2. If no user present, start a new local library FRESH
  }
  async getOp(id: Uuidv4): Promise<SyncOp> {
    let op = this.outbox.get(id.toHex());
    if (op) return op;
    const persisted = await this.adapter.getOutboxOp(id);
    if (!persisted) throw new Error(`op not found ${id}`);
    return persisted;
  }
  async removeItems(ids: Uuidv4[]) {
    ids.forEach((id) => this.stateCache.delete(id.toHex()));
    await this.adapter.deleteSyncObject(ids);
    // TODO: trigger subscription remove event!
  }
  // TODO: Trigger patch?
  subscribe() {
    // Ensure this happens in batches
  }
  setStateCache(obj: SyncObject) {
    const hexId = obj.id.toHex();
    this.stateCache.set(hexId, obj);
    this.opLibMap.set(obj.libraryId.toHex(), hexId);
  }
  async getObj(id: Uuidv4): Promise<SyncObject> {
    const mem = this.stateCache.get(id.toHex());
    if (mem) return mem;
    const persisted = await this.adapter.getSyncObject(id);
    if (!persisted) throw new Error(`object not found ${id}`);
    return persisted;
  }
  // TODO: Remove from cache etc
}
