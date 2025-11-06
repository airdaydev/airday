import { type DBSchema, type IDBPDatabase, openDB, type StoreNames } from "idb";
import { SyncOp } from "../sync/sync-op";
import { Uuidv4 } from "../common/uuid";
import { StorageAdapter } from "./adapter";
import { SyncObject } from "../sync/sync-object";

const SYNC_STORE_NAME = "sync_object"; // snapshot of merged ops i.e. entire object
const LIBRARY_STORE_NAME = "library";
const OUTBOX_STORE_NAME = "outbox";

export interface AirdayDBSchema extends DBSchema {
  [SYNC_STORE_NAME]: {
    key: Uint8Array;
    value: any;
    indexes: {
      libraryId: Uint8Array;
      objKind: number;
    };
  };
  [LIBRARY_STORE_NAME]: {
    key: Uint8Array;
    value: any;
    indexes: {};
  };
  [OUTBOX_STORE_NAME]: {
    key: Uint8Array;
    value: any;
    indexes: {};
  };
}

export type AirdayIDBPDatabase = IDBPDatabase<AirdayDBSchema>;
export type AirdayStoreNames = StoreNames<AirdayDBSchema>;

// Front-end persistent storage for Airday JS apps
export class AirdayIDBStorage implements StorageAdapter {
  handle: AirdayIDBPDatabase | null = null;
  constructor() {}
  connect = async () => {
    this.handle = await openDB("test", 1, {
      upgrade(db) {
        const objects = db.createObjectStore(SYNC_STORE_NAME, {
          keyPath: "id",
        });
        objects.createIndex("libraryId", "libraryId");
        objects.createIndex("objKind", "objKind");
        db.createObjectStore(LIBRARY_STORE_NAME, {
          keyPath: "id",
        });
        db.createObjectStore(OUTBOX_STORE_NAME, {
          keyPath: "id",
        });
      },
    });
  };
  addOp = async (op: SyncOp, object: SyncObject) => {
    const tx = this.handle!.transaction(
      [SYNC_STORE_NAME, OUTBOX_STORE_NAME],
      "readwrite",
    );
    const syncStore = tx.objectStore(SYNC_STORE_NAME);
    const outboxStore = tx.objectStore(OUTBOX_STORE_NAME);
    // TODO: Extract useful indexes e.g. archived
    const promises: Promise<Uint8Array>[] = [];
    promises.push(syncStore.put(object.toIdb())); // Assumption: this is latest state of objects
    promises.push(outboxStore.put(op.toIdb()));
    await Promise.all(promises);
    await tx.done;
  };
  getByLibrary = async (libraryId: Uuidv4) => {
    return this.handle!.getAllFromIndex(
      SYNC_STORE_NAME,
      "libraryId",
      libraryId,
    );
  };
  getOutboxOp = async (id: Uuidv4): Promise<SyncOp> => {
    const rawItem = await this.handle!.get(OUTBOX_STORE_NAME, id);
    return SyncOp.fromIdb(rawItem);
  };
  getSyncObject = (id: Uuidv4): Promise<SyncObject> => {
    return this.handle!.get(SYNC_STORE_NAME, id);
  };
  updateObject(object: SyncObject): Promise<void> {
    throw new Error("Not yet implemented");
  }
  deleteOutboxOp = async (id: Uuidv4): Promise<void> => {
    const tx = this.handle!.transaction(OUTBOX_STORE_NAME, "readwrite");
    const outboxStore = tx.objectStore(OUTBOX_STORE_NAME);
    await outboxStore.delete(id);
    await tx.done;
  };
  deleteSyncObject = async (hexIds: Uuidv4[]) => {
    // await this.db!.handle?.delete(SYNC_STORE_NAME, id);
    const tx = this.handle!.transaction(SYNC_STORE_NAME, "readwrite");
    const store = tx.objectStore(SYNC_STORE_NAME);
    await Promise.all(hexIds.map((id) => store.delete(id)));
    await tx.done;
  };
  clear = async () => {
    await this.handle?.clear("sync_object");
    await this.handle?.clear("library");
  };
}
