import { Accessor, createSignal, Signal } from 'solid-js';
import { store, AcmeIDB, dbNotReadyMessage } from './store';

export const [containers, setContainers] = createSignal<AcmeContainer[]>([]);

/**
 * Container model
 * Provides fast in memory store, idb persistence layer & websocket interface
 * TODO: Put DB functions in a base class
 */
export class ContainerModel {
    storeName = 'container';
    acmedb: AcmeIDB | null = null;
    signal: Signal<AcmeContainer[]>;
    constructor() {
        this.signal = createSignal<
        AcmeContainer[]>([]);
    }
    init = (db: AcmeIDB) => { this.acmedb = db; }
    ready() { return !!this.db; }
    get db() {
        if (!this.acmedb) throw new Error('Item store uninitialised');
        return this.acmedb;
    }
    insert = async(data: AcmeContainer | AcmeContainer[]) => {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const insert = async (item: AcmeContainer) => {
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
    getLists = async (): Promise<AcmeItem[]> => {
        const items = await this.db.getAll(this.storeName);
        return items;
    }
}

