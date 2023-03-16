import {
    IDBPDatabase, IDBPTransaction, openDB, deleteDB, wrap, unwrap,
} from 'idb';

const schemaVersion = 1;

type StoreAction = 'add' | 'remove' | 'update' | 'move' | 'complete';

// Anchor is used to anchor the beginning of each list
// Simple means to bolt on a sorted partitioned list within the same idb store
type Anchor = { type: 'anchor' };

interface DBTypes {
    items: AcmeItem | Anchor;
}

const itemStoreName = 'item';
const listStoreName = 'list';
// Remote Config store per browser (but could do local storage)
const dbNotReadyMessage = 'DB not loaded, pre-load buffer not yet implemented';

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
                db.createObjectStore(listStoreName, {
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
    insertLists = async(data: AcmeList | AcmeList[]) => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        const tx = this.db.transaction(listStoreName, 'readwrite');
        const store = tx.objectStore(listStoreName);
        const insert = async (item: AcmeList) => {
            const prev = await store.get(item.id);
            if (prev) throw new Error('Key already exists');
            const val = await store.add(item);
            return val;
        };
        if (Array.isArray(data)) {
            await data.map((item) => insert(item));
        } else {
            insert(data);
        }
        await tx.done;
    }
    subscribe(eventName: string, callback: () => void) {
        return this.events.addEventListener(eventName, callback);
    }
    getItemsByList = async (listId: string): Promise<AcmeItem[]> => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        const range = IDBKeyRange.bound([listId, 'A'], [listId, 'zzzzzz']);
        const items = await this.db.getAllFromIndex(itemStoreName, 'ordered', range);
        return items;
    }
    getLists = async (): Promise<AcmeItem[]> => {
        if (!this.db) throw new Error(dbNotReadyMessage);
        const items = await this.db.getAll(itemStoreName);
        return items;
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
