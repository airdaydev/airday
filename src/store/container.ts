import { Accessor, createSignal, Setter, Signal } from 'solid-js';
import { store, AcmeIDB, dbNotReadyMessage } from './main';

export const [containers, setContainers] = createSignal<AcmeContainer[]>([]);

/**
 * Container model
 * Provides fast in memory store, idb persistence layer & websocket interface
 * TODO: Put DB functions in a base class
 */
export class ContainerModel {
    storeName = 'container';
    acmedb: AcmeIDB | null = null;
    accessor: Accessor<AcmeContainer[]>;
    setter: Setter<AcmeContainer[]>;
    constructor() {
        const signal = createSignal<AcmeContainer[]>([]);
        this.accessor = signal[0];
        this.setter = signal[1];
    }
    init = (db: AcmeIDB) => { this.acmedb = db; }
    ready() { return !!this.db; }
    get db() {
        // TODO: This COULD be made redundant with proper queuing system
        if (!this.acmedb) throw new Error('Item store uninitialised');
        return this.acmedb;
    }
    insert = (data: AcmeContainer | AcmeContainer[]) => {
        // TODO: Insert into queue, then update idb
        const list = this.setter((prev) => {
            if (Array.isArray(data)) {
                const arr = [...prev, ...data];
                return arr;
            } else {
                const arr = [...prev, data];
                return arr
            }
        });
    }
    idb_insert = async(data: AcmeContainer | AcmeContainer[]) => {
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
