import {
    IDBPDatabase, IDBPTransaction, openDB, deleteDB, wrap, unwrap,
} from 'idb';
import { nanoid } from 'nanoid';

const schemaVersion = 1;

type StoreAction = 'add' | 'remove' | 'update' | 'move' | 'complete';

// Anchor is used to anchor the beginning of each list
// Simple means to bolt on a sorted partitioned list within the same idb store
type Anchor = { type: 'anchor' };

interface DBTypes {
    items: AcmeItem | Anchor;
}

const itemStoreName = 'item';
const dbNotReadyMessage = 'DB not loaded, pre-load buffer not yet implemented';

// TODO: Buffer changes before application loads
// TODO: Sample updates
// Primary local persistence layer
class AcmeLocalStore {
    db: IDBPDatabase<DBTypes> | null = null;
    events = new EventTarget();
    init = async () => {
        await deleteDB('acme');
        this.db = await openDB<DBTypes>('acme', schemaVersion, {
            upgrade(db) {
                const itemStore = db.createObjectStore(itemStoreName, {
                    keyPath: 'id',
                });
                itemStore.createIndex('listId', 'listId');
                itemStore.createIndex('ordered', ['listId', 'sortKey', 'id']);
            },
        });
    }
    /**
     * Insert new tasks, generating a new key
     * @param data 
     */
    insert = async (data: AcmeItem | AcmeItem[]) => {
        // Track touched lists to trigger batched UI refresh
        const touchedLists = new Set<string>();
        if (!this.db) throw new Error(dbNotReadyMessage);
        const tx = this.db.transaction(itemStoreName, 'readwrite');
        const store = tx.objectStore(itemStoreName);
        const insert = async (item: AcmeItem) => {
            const prev = await store.get(item.id);
            if (prev) throw new Error('Key already exists');
            const val = await store.add(item);
            touchedLists.add(item.listId);
            return val;
        };
        if (Array.isArray(data)) {
            await data.map((item) => insert(item));
        } else {
            insert(data);
        }
        await tx.done;
        touchedLists.forEach((listId) => this.events.dispatchEvent(new Event(`list-update-${listId}`)));
    }
    subscribe(eventName: string, callback: () => void) {
        console.log('subscribing', eventName)
        return this.events.addEventListener(eventName, callback);
    }
    getItemsByList = async (listId: string): Promise<AcmeItem[]> => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        const range = IDBKeyRange.bound([listId, 'A'], [listId, 'zzzzzz']);
        const items = await this.db.getAllFromIndex(itemStoreName, 'ordered', range);
        return items;
    }
    getRange = async (start: AcmeItem, end: AcmeItem) => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        const tx = await this.db.transaction(itemStoreName, 'readonly');
        const index = tx.objectStore(itemStoreName).index('ordered');
        const startIndex = [start.listId, start.sortKey, start.id];
        const endIndex = [end.listId, end.sortKey, end.id];
        const range = IDBKeyRange.bound(startIndex, endIndex);
        const cursor = await index.openCursor(range);
        let items = [];
        while (cursor) {
            items.push(cursor.value);
            await cursor.continue();
        }
        return items;
    }
    /**
     * @deprecated
     * @returns 
     */
    getRangeViaIndex = async (start: AcmeItem, vector: number, direction: ListDirection = 'next') => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        const tx = await this.db.transaction(itemStoreName, 'readonly');
        const index = tx.objectStore(itemStoreName).index('ordered');
        const itemIndex = [start.listId, start.sortKey, start.id];
        const range = IDBKeyRange.lowerBound(itemIndex, true);
        const cursor = await index.openCursor(range, direction);
        let items = [];
        for (let i = 0; i < vector; i++) {
            if (!cursor) break;
            items.push(cursor.value);
            await cursor.continue();
        }
        return items;
    }
    getItemById = async (id: string): Promise<AcmeItem | null> => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        const tx = await this.db.transaction(itemStoreName, 'readonly');
        const items = tx.objectStore(itemStoreName);
        return items.get(id);
    }
    /**
     * @deprecated
     * @returns 
     */
    getOLKeyFromId = async (id: string): Promise<[string, string, string] | null> => {
        const item = await this.getItemById(id);
        if (!item) return null;
        return [item.listId, item.sortKey, item.id]
    }
    // Optimisation opportunity - reference OLKey directly
    /**
     * @deprecated
     * @returns 
     */
    getNeighbour = async (
        originKey: string,
        direction: ListDirection = 'next',
        skipCondition?: (item: AcmeItem) => boolean,
    ): Promise<AcmeItem | null> => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        const key = await this.getOLKeyFromId(originKey);
        if (!key) return null;
        const tx = await this.db.transaction(itemStoreName, 'readonly');
        const index = tx.objectStore(itemStoreName).index('ordered');
        let range;
        if (direction === 'next') {
            range = IDBKeyRange.bound(key, [key[0], 'zzzzzz'], true);
        } else {
            range = IDBKeyRange.bound([key[0], 'A'], key, false);
        }
        const cursor = await index.openCursor(range, direction);
        if (direction === 'prev' && cursor) await cursor.continue();
        while (cursor) {
            const val = cursor.value;
            if (skipCondition && skipCondition(val)) {
                await cursor.continue();
            } else {
                return val;
            }
        }
        return null;
    }
    update = async (id: string, attributes: Partial<AcmeItem>) => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        
    }
    move = async (id: string, attributes: Partial<AcmeItem>) => {
        if (!this.db) throw new Error(dbNotReadyMessage);   
    }
    remove = async (id: string, attributes: Partial<AcmeItem>) => {
        if (!this.db) throw new Error(dbNotReadyMessage);
    }
    complete = async (id: string) => {
        if (!this.db) throw new Error(dbNotReadyMessage);
    }
}

export const store = new AcmeLocalStore();
