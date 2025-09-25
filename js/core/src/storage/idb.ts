import { type DBSchema, type IDBPDatabase, openDB, type StoreNames } from "idb";
import { parseGenericSyncObject, SyncObject } from "../sync/sync-object";
import { SyncOp } from "../sync/fb";

const SYNC_STORE_NAME = "sync_object";
const LIBRARY_STORE_NAME = "library";
const OUTBOX_STORE_NAME = "outbox";

export interface AirdayDBSchema extends DBSchema {
  [SYNC_STORE_NAME]: {
    key: string;
    value: any;
    indexes: {
      libraryId: string;
      objKind: number;
    };
  };
  [LIBRARY_STORE_NAME]: {
    key: string;
    value: any;
    indexes: {};
  };
  [OUTBOX_STORE_NAME]: {
    key: string;
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
        const library = db.createObjectStore(LIBRARY_STORE_NAME, {
          keyPath: "id",
        });
        const outbox = db.createObjectStore(OUTBOX_STORE_NAME, {
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
    const promises: Promise<string>[] = [];
    ops.map((op) => {
      promises.push(outboxStore.put(op.toIdb()));
      promises.push(syncStore.put(op.syncObject.toIdb())); // Assumption: this is latest state of objects
    });
    await Promise.all(promises);
    await tx.done;
  };
  getByLibrary = async (libraryId: string) => {
    const res = await this.handle!.getAllFromIndex(
      SYNC_STORE_NAME,
      "libraryId",
      libraryId,
    );
    const objects: SyncObject[] = [];
    res.forEach((row) => {
      try {
        const meta = parseGenericSyncObject(row);
        // TODO: Get attributes & build object
        // objects.push(SyncObject());
      } catch (err) {
        console.warn("Could not parse row from db", row, err);
      }
    });
    return objects;
  };
  delete = async (hexIds: string[]) => {
    // await this.db!.handle?.delete(SYNC_STORE_NAME, id);
    const tx = this.handle!.transaction(SYNC_STORE_NAME, "readwrite");
    const store = tx.objectStore(SYNC_STORE_NAME);
    await Promise.all(hexIds.map((id) => store.delete(id)));
    await tx.done;
  };
}
