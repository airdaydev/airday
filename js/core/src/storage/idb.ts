import { type DBSchema, type IDBPDatabase, openDB, type StoreNames } from "idb";
import { AirdayItem, type AirdayItemSerialised } from "../sync/model";

export interface AirdayDBSchema extends DBSchema {
  item: {
    key: string;
    value: any;
    indexes: {
      workspaceId: string;
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
// TODO: Workspace model?
export class AirdayIDB {
  handle: AirdayIDBPDatabase | null = null;
  item = new ItemIDBModel(this);
  constructor() {}
  connect = async () => {
    this.handle = await openDB("test", 1, {
      upgrade(db) {
        const items = db.createObjectStore(ITEM_STORE_NAME, { keyPath: "id" });
        items.createIndex("workspaceId", "workspaceId");
        // items.createIndex("listId", "listId");
        // items.createIndex("order", ["listId", "orderKey", "id"]);
        // items.createIndex("done", ["doneTS"]); // TODO: Done timestamp?
        const container = db.createObjectStore("container", { keyPath: "id" });
      },
    });
  };
}

export class ItemIDBModel {
  db: AirdayIDB;
  storeName = ITEM_STORE_NAME;
  constructor(db: AirdayIDB) {
    this.db = db;
  }
  insert = async (items: AirdayItem[]) => {
    const tx = this.db.handle!.transaction(ITEM_STORE_NAME, "readwrite");
    const store = tx.objectStore(ITEM_STORE_NAME);
    // TODO: Not gonna throw when merging tho
    const upsert = async (item: AirdayItemSerialised) => {
      const val = await store.add(item);
      return val;
    };
    items.map((item) => upsert(item.toJSON()));
    await tx.done;
  };
  getItemsByWorkspace = async (workspaceId: string) => {
    const res = await this.db.handle!.getAllFromIndex(
      ITEM_STORE_NAME,
      "workspaceId",
      workspaceId,
    );
    res.map((row) => {});
  };
}
