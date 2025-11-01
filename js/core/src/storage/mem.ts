import {
  HexUuid,
  LibraryHexUuid,
  SyncObjectHexUuid,
  Uuidv4,
} from "../common/uuid";
import { DBSyncObject, SyncObject } from "../sync/sync-object";
import { SerialisedSyncOp, SyncOp } from "../sync/sync-op";
import { StorageAdapter } from "./adapter";

// In-memory storage adapter for headless testing environments
export class AirdayMemStorage implements StorageAdapter {
  private syncObjects: Map<SyncObjectHexUuid, DBSyncObject> = new Map();
  private libraryIndex: Map<LibraryHexUuid, Set<SyncObjectHexUuid>> = new Map(); // TODO: id or outbox id?
  private outbox: Map<HexUuid, SerialisedSyncOp> = new Map();
  // TODO: op storage?

  async connect() {
    console.warn("initialised mem storage adapter, no persistence enabled");
  }

  async addOp(op: SyncOp, object: SyncObject) {
    const outboxItem = op.toIdb();
    const opIdKey = op.id.toHex();
    const libraryKey = op.libraryId.toHex();
    this.syncObjects.set(object.id.toHex(), object.toIdb());
    this.outbox.set(opIdKey, outboxItem);
    if (!this.libraryIndex.has(libraryKey)) {
      this.libraryIndex.set(libraryKey, new Set());
    }
    this.libraryIndex.get(libraryKey)!.add(opIdKey);
  }

  async getByLibrary(libraryId: Uuidv4): Promise<any[]> {
    const libraryKey = libraryId.toHex();
    const objectIds = this.libraryIndex.get(libraryKey);
    if (!objectIds) {
      return [];
    }
    const results: any[] = [];
    for (const id of objectIds) {
      const obj = this.syncObjects.get(id);
      if (obj) {
        results.push(obj);
      }
    }
    return results;
  }

  async getOutboxOp(id: Uuidv4): Promise<any> {
    return this.outbox.get(id.toHex());
  }

  async getSyncObject(id: Uuidv4): Promise<any> {
    return this.syncObjects.get(id.toHex());
  }

  updateObject(object: SyncObject): Promise<void> {
    throw new Error("Not yet implemented");
  }

  async delete(hexIds: Uuidv4[]): Promise<void> {
    for (const id of hexIds) {
      const key = id.toHex();
      const obj = this.syncObjects.get(key);
      if (obj && obj.libraryId) {
        const libraryKey = obj.libraryId.toHex();
        const librarySet = this.libraryIndex.get(libraryKey);
        if (librarySet) {
          librarySet.delete(key);
          if (librarySet.size === 0) {
            this.libraryIndex.delete(libraryKey);
          }
        }
      }
      this.syncObjects.delete(key);
      this.outbox.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.syncObjects.clear();
    this.outbox.clear();
    this.libraryIndex.clear();
  }
}
