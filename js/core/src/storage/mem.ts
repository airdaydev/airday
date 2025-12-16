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

class SessionStorage {
  libraries: Map<LibraryHexUuid, Library> = new Map();
  syncObjects: Map<SyncObjectHexUuid, SyncObject> = new Map(); // TODO: Serialised version?
  objLibKey: Map<LibraryHexUuid, Set<SyncObjectHexUuid>> = new Map();
  // TODO: Do we need a lib op key?
  outbox: Map<HexUuid, SyncOp> = new Map(); // TODO: Serialised version?
  // TODO: op storage?
}

// In-memory storage adapter for headless testing environments
// TODO: Consider shipping this is a bun sql backend
export class AirdayMemStorage implements StorageAdapter {
  userId?: Uuidv4;
  private backend = new Map<Uuidv4, SessionStorage>();
  private active?: SessionStorage;

  async connect(userId: Uuidv4) {
    const storage = this.backend.get(userId);
    this.active = storage;
    if (storage) return;
    const newStorage = new SessionStorage();
    this.backend.set(userId, newStorage);
    this.active = newStorage;
  }

  async addOp(op: SyncOp, object: SyncObject) {
    if (!this.active) throw new Error("Storage not active");
    // const outboxItem = op.toIdb(); TODO: serialise properly
    const opIdKey = op.id.toHex();
    const libraryKey = op.libraryId.toHex();
    const objKey = object.id.toHex();
    this.active.syncObjects.set(objKey, object);
    this.active.outbox.set(opIdKey, op);
    if (!this.active.objLibKey.has(libraryKey)) {
      this.active.objLibKey.set(libraryKey, new Set());
    }
    this.active.objLibKey.get(libraryKey)!.add(objKey);
  }

  async getByLibrary(libraryId: Uuidv4): Promise<any[]> {
    if (!this.active) throw new Error("Storage not active");
    const libraryKey = libraryId.toHex();
    const objectIds = this.active.objLibKey.get(libraryKey);
    if (!objectIds) {
      return [];
    }
    const results: any[] = [];
    for (const id of objectIds) {
      const obj = this.active.syncObjects.get(id);
      if (obj) {
        results.push(obj);
      }
    }
    return results;
  }

  async getOutboxOp(id: Uuidv4): Promise<SyncOp> {
    if (!this.active) throw new Error("Storage not active");
    const op = this.active.outbox.get(id.toHex());
    if (!op) throw new Error(`could not find outbox op ${id}`);
    return op;
  }
  async deleteOutboxOp(id: Uuidv4): Promise<any> {
    if (!this.active) throw new Error("Storage not active");
    this.active.outbox.delete(id.toHex());
  }

  async getSyncObject(id: Uuidv4): Promise<SyncObject> {
    if (!this.active) throw new Error("Storage not active");
    const obj = this.active.syncObjects.get(id.toHex());
    if (!obj) throw new Error(`could not find syncObject ${id}`);
    return obj;
  }

  async updateObject(obj: SyncObject): Promise<void> {
    if (!this.active) throw new Error("Storage not active");
    this.active.syncObjects.set(obj.id.toHex(), obj);
  }

  async deleteSyncObject(hexIds: Uuidv4[]): Promise<void> {
    if (!this.active) throw new Error("Storage not active");
    for (const id of hexIds) {
      const key = id.toHex();
      const obj = this.active.syncObjects.get(key);
      if (obj && obj.libraryId) {
        const libraryKey = obj.libraryId.toHex();
        const librarySet = this.active.objLibKey.get(libraryKey);
        if (librarySet) {
          librarySet.delete(key);
          if (librarySet.size === 0) {
            this.active.objLibKey.delete(libraryKey);
          }
        }
      }
      this.active.syncObjects.delete(key);
      this.active.outbox.delete(key);
    }
  }

  async addLibrary(library: Library) {
    if (!this.active) throw new Error("Storage not active");
    this.active.libraries.set(library.id.toHex(), library);
  }

  async getLibrary(libraryId: Uuidv4): Promise<Library | undefined> {
    if (!this.active) throw new Error("Storage not active");
    const lib = this.active.libraries.get(libraryId.toHex());
    return lib;
  }

  async clear(): Promise<void> {
    if (!this.active) throw new Error("Storage not active");
    this.active.syncObjects.clear();
    this.active.outbox.clear();
    this.active.objLibKey.clear();
  }
}
