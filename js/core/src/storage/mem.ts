import { Library } from "../common/library";
import {
  HexUuid,
  LibraryHexUuid,
  SyncObjectHexUuid,
  Uuidv4,
} from "../common/uuid";
import { SyncObject } from "../sync/sync-object";
import { SyncOp } from "../sync/sync-op";
import { StorageAdapter } from "./adapter";

// In-memory storage adapter for headless testing environments
export class AirdayMemStorage implements StorageAdapter {
  private libraries: Map<LibraryHexUuid, Library> = new Map();
  private syncObjects: Map<SyncObjectHexUuid, SyncObject> = new Map(); // TODO: Serialised version?
  private objLibKey: Map<LibraryHexUuid, Set<SyncObjectHexUuid>> = new Map();
  // TODO: Do we need a lib op key?
  private outbox: Map<HexUuid, SyncOp> = new Map(); // TODO: Serialised version?
  // TODO: op storage?

  async connect() {
    // TODO: Save name
  }

  async addOp(op: SyncOp, object: SyncObject) {
    // const outboxItem = op.toIdb(); TODO: serialise properly
    const opIdKey = op.id.toHex();
    const libraryKey = op.libraryId.toHex();
    const objKey = object.id.toHex();
    this.syncObjects.set(objKey, object);
    this.outbox.set(opIdKey, op);
    if (!this.objLibKey.has(libraryKey)) {
      this.objLibKey.set(libraryKey, new Set());
    }
    this.objLibKey.get(libraryKey)!.add(objKey);
  }

  async getByLibrary(libraryId: Uuidv4): Promise<any[]> {
    const libraryKey = libraryId.toHex();
    const objectIds = this.objLibKey.get(libraryKey);
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

  async getOutboxOp(id: Uuidv4): Promise<SyncOp> {
    const op = this.outbox.get(id.toHex());
    if (!op) throw new Error(`could not find outbox op ${id}`);
    return op;
  }
  async deleteOutboxOp(id: Uuidv4): Promise<any> {
    this.outbox.delete(id.toHex());
  }

  async getSyncObject(id: Uuidv4): Promise<SyncObject> {
    const obj = this.syncObjects.get(id.toHex());
    if (!obj) throw new Error(`could not find syncObject ${id}`);
    return obj;
  }

  async updateObject(obj: SyncObject): Promise<void> {
    this.syncObjects.set(obj.id.toHex(), obj);
  }

  async deleteSyncObject(hexIds: Uuidv4[]): Promise<void> {
    for (const id of hexIds) {
      const key = id.toHex();
      const obj = this.syncObjects.get(key);
      if (obj && obj.libraryId) {
        const libraryKey = obj.libraryId.toHex();
        const librarySet = this.objLibKey.get(libraryKey);
        if (librarySet) {
          librarySet.delete(key);
          if (librarySet.size === 0) {
            this.objLibKey.delete(libraryKey);
          }
        }
      }
      this.syncObjects.delete(key);
      this.outbox.delete(key);
    }
  }

  async createLibrary(library: Library) {
    this.libraries.set(library.id.toHex(), library);
  }

  async getLibrary(libraryId: Uuidv4): Promise<Library | undefined> {
    return this.libraries.get(libraryId.toHex());
  }

  async clear(): Promise<void> {
    this.syncObjects.clear();
    this.outbox.clear();
    this.objLibKey.clear();
  }
}
