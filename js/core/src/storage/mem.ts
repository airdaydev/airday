import { Uuidv4 } from "../common/uuid";
import { SyncOp } from "../sync/fb";
import { StorageAdapter } from "./adapter";

// In-memory storage adapter for testing and headless environments
export class AirdayMemStorage implements StorageAdapter {
  private syncObjects: Map<string, any> = new Map();
  private outbox: Map<string, any> = new Map();
  private libraryIndex: Map<string, Set<string>> = new Map();

  async connect() {
    console.warn("initialised mem storage adapter, no persistence enabled");
  }

  async addOps(ops: SyncOp[]) {
    for (const op of ops) {
      const syncObj = op.syncObject.toIdb();
      const outboxItem = op.toIdb();
      const idKey = syncObj.id.toHex();
      const libraryKey = syncObj.libraryId.toHex();
      this.syncObjects.set(idKey, syncObj);
      this.outbox.set(idKey, outboxItem);
      if (!this.libraryIndex.has(libraryKey)) {
        this.libraryIndex.set(libraryKey, new Set());
      }
      this.libraryIndex.get(libraryKey)!.add(idKey);
    }
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

  async getOutboxItem(id: Uuidv4): Promise<any> {
    return this.outbox.get(id.toHex());
  }

  async getSyncObject(id: Uuidv4): Promise<any> {
    return this.syncObjects.get(id.toHex());
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
