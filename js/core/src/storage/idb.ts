import { type DBSchema, type IDBPDatabase, openDB, type StoreNames } from "idb";
import { parseGenericSyncObject, SyncObject } from "../sync/sync-object";

const SYNC_STORE_NAME = "syncable";
const LIBRARY_STORE_NAME = "library";

export interface AirdayDBSchema extends DBSchema {
  [SYNC_STORE_NAME]: {
    key: string;
    value: any;
    indexes: {
      libraryId: string;
      type: "item" | "container";
    };
  };
  [LIBRARY_STORE_NAME]: {
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
        objects.createIndex("type", "type");
        const library = db.createObjectStore(LIBRARY_STORE_NAME, {
          keyPath: "id",
        });
      },
    });
  };
  upsert = async (objects: SyncObject[]) => {
    const tx = this.handle!.transaction(SYNC_STORE_NAME, "readwrite");
    const store = tx.objectStore(SYNC_STORE_NAME);
    const b = await store.getAll();
    // TODO: We also need to extract indexes in JSON version (e.g. done)!
    await Promise.all(
      objects.map((obj) => {
        return store.put(obj.toDB());
      }),
    );
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
        objects.push(SyncObject.fromJSON(row));
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
