import { type DBSchema, type IDBPDatabase, openDB, deleteDB } from "idb";
import { type WALEntry } from "./wal";

interface AirdayDBSchema extends DBSchema {
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

// Front-end persistent storage for Airday JS apps
export class AirdayIDB {
  private db: AirdayIDBPDatabase | null = null;
  constructor() {}
  connect = async () => {
    this.db = await openDB("test", 1, {
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
  };
}
