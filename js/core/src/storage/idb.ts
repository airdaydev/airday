import { type DBSchema, type IDBPDatabase, openDB, type StoreNames } from "idb";
import { parseGenericSyncObject, SyncObject } from "../sync/sync-object";
import { SyncOp } from "../sync/fb";
import { Uuidv4 } from "../common/uuid";

const SYNC_STORE_NAME = "sync_object";
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
export class AirdayIDB {
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
  addOps = async (ops: SyncOp[]) => {
    const tx = this.handle!.transaction(
      [SYNC_STORE_NAME, OUTBOX_STORE_NAME],
      "readwrite",
    );
    const syncStore = tx.objectStore(SYNC_STORE_NAME);
    const outboxStore = tx.objectStore(OUTBOX_STORE_NAME);
    // TODO: Extract useful indexes e.g. archived
    const promises: Promise<Uint8Array>[] = [];
    ops.map((op) => {
      promises.push(syncStore.put(op.syncObject.toIdb())); // Assumption: this is latest state of objects
      promises.push(outboxStore.put(op.toIdb()));
    });
    await Promise.all(promises);
    await tx.done;
    console.log("transaction done with", promises.length, "promises");
  };
  getByLibrary = async (libraryId: Uuidv4) => {
    return this.handle!.getAllFromIndex(
      SYNC_STORE_NAME,
      "libraryId",
      libraryId,
    );
  };
  getOutboxItem = (id: Uuidv4) => {
    return this.handle!.get(OUTBOX_STORE_NAME, id);
  };
  getSyncObject = (id: Uuidv4) => {
    console.log("calling getsyncobj with", id);
    return this.handle!.get(SYNC_STORE_NAME, id);
  };
  delete = async (hexIds: Uuidv4[]) => {
    // await this.db!.handle?.delete(SYNC_STORE_NAME, id);
    const tx = this.handle!.transaction(SYNC_STORE_NAME, "readwrite");
    const store = tx.objectStore(SYNC_STORE_NAME);
    await Promise.all(hexIds.map((id) => store.delete(id)));
    await tx.done;
  };
}
