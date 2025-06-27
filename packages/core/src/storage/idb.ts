import {
  type DBSchema,
  type IDBPDatabase,
  openDB,
  deleteDB,
  type StoreNames,
} from "idb";
import { WAL, type WALEntry } from "./wal";

export interface AirdayDBSchema extends DBSchema {
  wal: {
    key: string;
    value: WALEntry;
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

// Front-end persistent storage for Airday JS apps
export class AirdayIDB {
  handle: AirdayIDBPDatabase | null = null;
  wal = new WAL();
  constructor() {}
  connect = async () => {
    this.handle = await openDB("test", 1, {
      upgrade(db) {
        const store = db.createObjectStore("wal", { keyPath: "id" });
        store.createIndex("timestamp", "timestamp");
        const items = db.createObjectStore("item", { keyPath: "id" });
        items.createIndex("listId", "listId");
        items.createIndex("order", ["listId", "orderKey", "id"]);
        items.createIndex("done", ["doneTS"]); // TODO: Done timestamp?
        const container = db.createObjectStore("container", { keyPath: "id" });
      },
    });
    this.wal.setDB(this.handle);
  };
  isReady = async (): Promise<boolean> => {
    return this.handle !== null;
  };
}
