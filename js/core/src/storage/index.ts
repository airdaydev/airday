// Memory storage for items (or all resources?)
import { SessionState } from "../session/types";
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
  ready: {};
  upsert: { objects: SyncObject[] };
  delete: { ids: string[] };
}

enum StorageState {
  NotReady,
  Ready,
}

export class AirdayStorage {
  core: AirdayCore;
  adapter: StorageAdapter;
  state = StorageState.NotReady;
  // Library storage
  primaryLibraryId?: Uuidv4;
  libraries: Map<LibraryHexUuid, Library> = new Map();
  // OpCache
  stateCache: Map<SyncObjectHexUuid, SyncObject> = new Map();
  outbox: Map<HexUuid, SyncOp> = new Map();
  // Pending DB updates
  outboxDirty: Set<Uuidv4> = new Set();
  objectDirty: Set<Uuidv4> = new Set();
  // Reactivity
  events = new EventEmitter<StorageEventMap>();
  constructor(core: AirdayCore, adapter?: StorageAdapter) {
    this.core = core;
    this.adapter = adapter || new AirdayIDBStorage();
  }
  async initDb(sessionState: SessionState, remote: boolean) {
    // TODO: Check DB status, may be connected
    await this.adapter.connect(sessionState.userId);
    // Construct primary library (TODO: Elsewhere?)
    const library = new Library({
      id: sessionState.primaryLibraryId,
      remote,
      name: "default",
      primary: true,
    });
    await this.adapter.addLibrary(library);
    this.state = StorageState.Ready;
    this.events.emit("ready", {});
  }
  async whenReady(): Promise<void> {
    if (this.state === StorageState.Ready) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.events.once("ready", () => {
        resolve();
      });
    });
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
  }
  setStateCache(obj: SyncObject) {
    const hexId = obj.id.toHex();
    this.stateCache.set(hexId, obj);
  }
  async getObj(id: Uuidv4): Promise<SyncObject | undefined> {
    const mem = this.stateCache.get(id.toHex());
    if (mem) return mem;
    const persisted = await this.adapter.getSyncObject(id);
    if (persisted) {
      this.stateCache.set(id.toHex(), persisted);
    }
    return persisted;
  }
  async persistence() {
    // TODO: When there are items in queue, run at least once every 16ms
    // Taking up to 500 at a time
    // TODO: as a transaction
    // await this.core.storage.adapter.deleteOutboxOp(op.id); // Job is done
    // await this.core.storage.adapter.updateObject(obj); // PERSIST CHANGE!
  }
}
