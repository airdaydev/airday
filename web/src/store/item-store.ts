import { IDBPObjectStore } from "idb";
import { SunlistIDB } from "./main";
import { Queue } from "./queue";
import { Trx } from "./trx";

/**
 * Item model provides idb persistence layer & websocket interface
 */
export class ItemStore {
  storeName = "item";
  sundb: SunlistIDB | null = null;
  queue = new Queue<Trx>();
  init = (db: SunlistIDB) => {
    this.sundb = db;
  };
  upgrade = (db: SunlistIDB) => {
    const itemStore = db.createObjectStore(this.storeName, {
      keyPath: "id",
    });
    itemStore.createIndex("listId", "listId");
    itemStore.createIndex("ordered", ["listId", "sortKey", "id"]);
    itemStore.createIndex("done", ["tsDone"]);
  };
  ready() {
    return !!this.db;
  }
  get db() {
    if (!this.sundb) throw new Error("Item store uninitialised");
    return this.sundb;
  }
  /**
   * Insert new tasks, generating a new key
   * @param data
   */
  insert = async (data: SunlistItem | SunlistItem[]) => {
    const tx = this.db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);
    const insert = async (item: SunlistItem) => {
      const prev = await store.get(item.id);
      if (prev) throw new Error("Key already exists");
      const val = await store.add(item);
      return val;
    };
    if (Array.isArray(data)) {
      await data.map((item) => insert(item));
    } else {
      insert(data);
    }
    await tx.done;
  };
  getItemsByList = async (listId: string): Promise<SunlistItem[]> => {
    if (!listId) {
      console.warn("attempted to getItemsByList with null listId");
      return [];
    }
    const range = IDBKeyRange.bound([listId, "A"], [listId, "zzzzzz"]);
    const items = await this.db.getAllFromIndex(
      this.storeName,
      "ordered",
      range,
    );
    return items;
  };
  loadCompletedItems = async (fromDate?: Date): Promise<SunlistItem[]> => {
    if (!this.db) {
      throw new Error("Item store not initialised.");
    }
    // const now = IDBKeyRange.upperBound([new Date()])
    // const cursor = this.itemStore.openCursor(now, 'next'); // initially, from null index
    const items = await this.db.getAllFromIndex(this.storeName, "done");
    // const items = await this.db.g(this.storeName, 'done', now);
    return items;
  };
  // Generic update
  update = async (id: string, attributes: Partial<SunlistItem>) => {
    const item = await this.db.get(this.storeName, id);
    const updated = { ...item, ...attributes };
    this.queue.enqueue({ type: "update", item: updated });
    await this.db.put(this.storeName, updated).catch((err) => console.log(err));
  };
  move = async (id: string, attributes: Partial<SunlistItem>) => {};
  remove = async (id: string) => {
    if (!this.db) {
      throw new Error("Item store not initialised.");
    }
    await this.db.delete(this.storeName, id);
    this.queue.enqueue({ type: "remove", id });
  };
  check = async (id: string, tsDone: Date) => {
    const item = await this.db.get(this.storeName, id);
    const updatedItem = {
      ...item,
      tsDone,
      listId: "archive",
      from: item.listId,
    };
    await this.db
      .put(this.storeName, updatedItem)
      .catch((err) => console.log(err));
    return updatedItem;
  };
  uncheck = async (id: string) => {
    const item = await this.db.get(this.storeName, id);
    const updatedItem = { ...item, tsDone: null, listId: item.from };
    await this.db
      .put(this.storeName, updatedItem)
      .catch((err) => console.log(err));
    return updatedItem;
  };
}
