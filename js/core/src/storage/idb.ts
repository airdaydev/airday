import { type DBSchema, type IDBPDatabase, openDB, type StoreNames } from "idb";
import { AirdayItem, type AirdayItemSerialised } from "../sync/model";

export interface AirdayDBSchema extends DBSchema {
  item: {
    key: string;
    value: any;
    indexes: {
      libraryId: string;
      // listId: string;
      // order: [string, string, string];
      // done: string;
    };
  };
  container: {
    key: string;
    value: any;
    indexes: {};
  };
}

export type AirdayIDBPDatabase = IDBPDatabase<AirdayDBSchema>;
export type AirdayStoreNames = StoreNames<AirdayDBSchema>;

const ITEM_STORE_NAME = "item";

// Front-end persistent storage for Airday JS apps
export class AirdayIDB {
  handle: AirdayIDBPDatabase | null = null;
  item = new ItemIDBModel(this);
  constructor() {}
  connect = async () => {
    this.handle = await openDB("test", 1, {
      upgrade(db) {
        const items = db.createObjectStore(ITEM_STORE_NAME, { keyPath: "id" });
        items.createIndex("libraryId", "libraryId");
        // items.createIndex("listId", "listId");
        // items.createIndex("order", ["listId", "orderKey", "id"]);
        // items.createIndex("done", ["doneTS"]); // TODO: Done timestamp?
        const container = db.createObjectStore("container", { keyPath: "id" });
      },
    });
  };
}

// TODO: Get completed items separately
export class ItemIDBModel {
  db: AirdayIDB;
  storeName = ITEM_STORE_NAME;
  constructor(db: AirdayIDB) {
    this.db = db;
  }
  // TODO: Should we just upsert!?
  insert = async (items: AirdayItem[]) => {
    const tx = this.db.handle!.transaction(ITEM_STORE_NAME, "readwrite");
    const store = tx.objectStore(ITEM_STORE_NAME);
    const b = await store.getAll();
    // TODO: We also need to extract indexes in JSON version (e.g. done)!
    await Promise.all(
      items.map((item) => {
        return store.add(item.toJSON());
      }),
    );
    await tx.done;
  };
  update = async (items: AirdayItem[]) => {
    const tx = this.db.handle!.transaction(ITEM_STORE_NAME, "readwrite");
    const store = tx.objectStore(ITEM_STORE_NAME);
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
      ITEM_STORE_NAME,
      "libraryId",
      libraryId,
    );
    const items: AirdayItem[] = [];
    res.forEach((row) => {
      try {
        items.push(AirdayItem.fromJSON(row));
      } catch (err) {
        console.warn("Could not parse row from db", row);
      }
    });
    return items;
  };
  deleteItem = async (id: string) => {
    await this.db!.handle?.delete(ITEM_STORE_NAME, id);
  };
}
