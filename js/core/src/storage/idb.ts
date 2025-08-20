import { type DBSchema, type IDBPDatabase, openDB, type StoreNames } from "idb";
import { AirdayItem, SyncObject } from "../sync/model";

const SYNC_STORE_NAME = "syncable";
const LIBRARY_STORE_NAME = "library";

export interface AirdayDBSchema extends DBSchema {
  [SYNC_STORE_NAME]: {
    key: string;
    value: any;
    indexes: {
      libraryId: string;
      // archived
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
  item = new ItemIDBModel(this);
  constructor() {}
  connect = async () => {
    this.handle = await openDB("test", 1, {
      upgrade(db) {
        const items = db.createObjectStore(SYNC_STORE_NAME, { keyPath: "id" });
        items.createIndex("libraryId", "libraryId");
        // items.createIndex("listId", "listId");
        // items.createIndex("order", ["listId", "orderKey", "id"]);
        // items.createIndex("done", ["doneTS"]); // TODO: Done timestamp?
        const container = db.createObjectStore(LIBRARY_STORE_NAME, {
          keyPath: "id",
        });
      },
    });
  };
}

// TODO: Get archived items separately (Decide what should be archived and provide common index)
export class ItemIDBModel {
  db: AirdayIDB;
  storeName = SYNC_STORE_NAME;
  constructor(db: AirdayIDB) {
    this.db = db;
  }
  upsert = async (items: SyncObject[]) => {
    const tx = this.db.handle!.transaction(SYNC_STORE_NAME, "readwrite");
    const store = tx.objectStore(SYNC_STORE_NAME);
    const b = await store.getAll();
    // TODO: We also need to extract indexes in JSON version (e.g. done)!
    await Promise.all(
      items.map((item) => {
        return store.put(item.toJSON());
      }),
    );
    await tx.done;
  };
  getItemsByLibrary = async (libraryId: string) => {
    const res = await this.db.handle!.getAllFromIndex(
      SYNC_STORE_NAME,
      "libraryId",
      libraryId,
    );
    const items: SyncObject[] = [];
    res.forEach((row) => {
      try {
        items.push(SyncObject.fromJSON(row));
      } catch (err) {
        console.warn("Could not parse row from db", row, err);
      }
    });
    return items;
  };
  deleteItems = async (hexIds: string[]) => {
    // await this.db!.handle?.delete(SYNC_STORE_NAME, id);
    const tx = this.db.handle!.transaction(SYNC_STORE_NAME, "readwrite");
    const store = tx.objectStore(SYNC_STORE_NAME);
    await Promise.all(hexIds.map((id) => store.delete(id)));
    await tx.done;
  };
}
