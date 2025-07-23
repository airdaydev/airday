import { type DBSchema, type IDBPDatabase, openDB, type StoreNames } from "idb";
import { WAL, type AirdayActionWALEntry } from "./wal";
import type { AirdayItem, AirdayItemFields } from "../sync/model";

export interface AirdayDBSchema extends DBSchema {
  wal: {
    key: string;
    value: AirdayActionWALEntry;
    indexes: {
      timestamp: number;
    };
  };
  item: {
    key: string;
    value: any;
    indexes: {
      listId: string;
      order: [string, string, string];
      done: string;
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
// TODO: Workspace model?
export class AirdayIDB {
  handle: AirdayIDBPDatabase | null = null;
  wal = new WAL();
  item = new ItemIDBModel(this);
  constructor() {}
  connect = async () => {
    this.handle = await openDB("test", 1, {
      upgrade(db) {
        const store = db.createObjectStore("wal", { keyPath: "id" });
        store.createIndex("timestamp", "timestamp");
        const items = db.createObjectStore(ITEM_STORE_NAME, { keyPath: "id" });
        items.createIndex("listId", "listId");
        items.createIndex("order", ["listId", "orderKey", "id"]);
        items.createIndex("done", ["doneTS"]); // TODO: Done timestamp?
        const container = db.createObjectStore("container", { keyPath: "id" });
      },
    });
    this.wal.setDB(this.handle);
  };
}

export class ItemIDBModel {
  db: AirdayIDB;
  storeName = ITEM_STORE_NAME;
  constructor(db: AirdayIDB) {
    this.db = db;
  }
  insert = async (items: AirdayItem | AirdayItem[]) => {
    const tx = this.db.handle!.transaction(ITEM_STORE_NAME, "readwrite");
    const store = tx.objectStore(ITEM_STORE_NAME);
    const insert = async (item: AirdayItemFields) => {
      const prev = await store.get(item.id.toString());
      if (prev) throw new Error("Key already exists");
      const val = await store.add(item);
      return val;
    };
    // TODO: pure json storage or flatbuffer?
    if (Array.isArray(items)) {
      items.map((item) => insert(item));
    } else {
      // insert(items);
    }
    await tx.done;
  };
}
