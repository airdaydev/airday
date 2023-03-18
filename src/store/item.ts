import { AcmeIDB, dbNotReadyMessage } from './store';

/**
 * Item model
 * Provides idb persistence layer & websocket interface
 * Note: Fast-list provides in-memory layer
 * TODO: Put DB functions in a base class
 */
export class ItemModel {
    storeName = 'item';
    acmedb: AcmeIDB | null = null;
    init = (db: AcmeIDB) => { this.acmedb = db; }
    ready() { return !!this.db; }
    get db() {
        if (!this.acmedb) throw new Error('Item store uninitialised');
        return this.acmedb;
    }
    /**
     * Insert new tasks, generating a new key
     * @param data 
     */
    insert = async (data: AcmeItem | AcmeItem[]) => {
        // Track touched lists to trigger batched UI refresh
        const touchedLists = new Set<string>();
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
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
        // TODO: Fast-list update sketch
        // touchedLists.forEach((listId) => this.events.dispatchEvent(new Event(`list-update-${listId}`)));
    }
    getItemsByList = async (listId: string): Promise<AcmeItem[]> => {
        const range = IDBKeyRange.bound([listId, 'A'], [listId, 'zzzzzz']);
        const items = await this.db.getAllFromIndex(this.storeName, 'ordered', range);
        return items;
    }
    update = async (id: string, attributes: Partial<AcmeItem>) => {
    }
    move = async (id: string, attributes: Partial<AcmeItem>) => {   
    }
    remove = async (id: string, attributes: Partial<AcmeItem>) => {
    }
    complete = async (id: string) => {
    }
}
