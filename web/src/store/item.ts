import { IDBPObjectStore } from 'idb';
import { BordeIDB } from './main';

/**
 * Item model
 * Provides idb persistence layer & websocket interface
 * Note: Fast-list provides in-memory layer
 * TODO: Put DB functions in a base class
 */
export class ItemModel {
    storeName = 'item';
    acmedb: BordeIDB | null = null;
    itemStore: IDBPObjectStore | null = null;
    init = (db: BordeIDB) => {
        this.acmedb = db;
        // this.load();
        // load
    }
    // load = async () => {
    //     const items = await this.db.getAll(this.storeName);
    // }
    upgrade = (db: BordeIDB) => {
        const itemStore = db.createObjectStore(this.storeName, {
            keyPath: 'id',
        });
        itemStore.createIndex('listId', 'listId');
        // itemStore.createIndex('id', 'id');
        itemStore.createIndex('ordered', ['listId', 'sortKey', 'id']);
        itemStore.createIndex('done', ['tsCompleted']);
    }
    ready() { return !!this.db; }
    get db() {
        if (!this.acmedb) throw new Error('Item store uninitialised');
        return this.acmedb;
    }
    /**
     * Insert new tasks, generating a new key
     * @param data 
     */
    insert = async (data: BordeItem | BordeItem[]) => {
        // Track touched lists to trigger batched UI refresh
        // const touchedLists = new Set<string>();
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const insert = async (item: BordeItem) => {
            const prev = await store.get(item.id);
            if (prev) throw new Error('Key already exists');
            const val = await store.add(item);
            // touchedLists.add(item.listId);
            return val;
        };
        if (Array.isArray(data)) {
            await data.map((item) => insert(item));
        } else {
            insert(data);
        }
        await tx.done;
        // TODO: Fast-list update sketch
        // touchedLists.forEach((listId) => this.events.dispatchEvent(new Event(`list-update-${listId}`)));
    }
    getItemsByList = async (listId: string): Promise<BordeItem[]> => {
        const range = IDBKeyRange.bound([listId, 'A'], [listId, 'zzzzzz']);
        const items = await this.db.getAllFromIndex(this.storeName, 'ordered', range);
        return items;
    }
    getCompletedItems = async (fromDate: Date): Promise<BordeItem[]> => {
        if (!this.db) {
            throw new Error('Item store not initialised.');
        }
        // const now = IDBKeyRange.upperBound([new Date()])
        // const cursor = this.itemStore.openCursor(now, 'next'); // initially, from null index
        const items = await this.db.getAllFromIndex(this.storeName, 'done');
        // const items = await this.db.g(this.storeName, 'done', now);
        return items;
    }
    update = async (id: string, attributes: Partial<BordeItem>) => {
        const item = await this.db.get(this.storeName, id);
        const update = { ...item, ...attributes };
        await this.db.put(this.storeName, update)
            .catch((err) => console.log(err))
    }
    move = async (id: string, attributes: Partial<BordeItem>) => {   
    }
    remove = async (id: string, attributes: Partial<BordeItem>) => {
    }
    complete = async (id: string, tsCompleted: Date | null) => {
        const item = await this.db.get(this.storeName, id);
        const update = { ...item, tsCompleted };
        await this.db.put(this.storeName, update)
            .catch((err) => console.log(err))
    }
}
