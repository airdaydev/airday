import { Accessor, createSignal, Setter, Signal } from 'solid-js';
import { store, AcmeIDB, dbNotReadyMessage } from './main';

export const [containers, setContainers] = createSignal<BordeContainer[]>([]);

// Structure:
// 1. signal(list of signal(items)) (sorted index)
// 2. Set(id, signal(items)) (hashed index of live item)
// TODO: Read https://github.com/solidjs/solid/discussions/749

/**
 * Container model i.e. data bucket e.g. a list
 * Provides fast in memory store, idb persistence layer & websocket interface
 * TODO: Put DB functions in a base class
 */
export class ContainerModel {
    storeName = 'container';
    acmedb: AcmeIDB | null = null;
    ol: Accessor<Accessor<BordeContainer>[]>;
    setOl: Setter<Accessor<BordeContainer>[]>;
    index = new Map<string, Signal<BordeContainer>>();
    map: Map<string, BordeContainer> = new Map();
    constructor() {
        const signal = createSignal<Accessor<BordeContainer>[]>([]);
        this.ol = signal[0];
        this.setOl = signal[1];
    }
    init = async (db: AcmeIDB) => {
        this.acmedb = db;
        this.clearCache();
    }
    clearCache = async () => {
        this.index.clear();
        this.setOl([]);
    }
    load = async () => {
        const items = await this.db.getAll(this.storeName);
        this.insert(items, false);
    }
    upgrade = (db: AcmeIDB) => {
        db.createObjectStore(this.storeName, {
            keyPath: 'id',
        });
    }
    ready() { return !!this.db; }
    get db() {
        // TODO: This COULD be made redundant with proper queuing system
        if (!this.acmedb) throw new Error('Item store uninitialised');
        return this.acmedb;
    }
    insert = async (data: BordeContainer | BordeContainer[], persist = true) => {
        // Convert to array
        const src = Array.isArray(data) ? data : [data];
        // Store in database (TODO: Optimisation: Immediately store in mem)
        // Generalised queue for database storage, prevent browser from closing while persistence layer continues
        // User UI treats memory as source of truth, though insight into persistence layers available
        // Dependent updates are possible and should occur as DAG (e.g. list -> item)
        const dbPromises: Promise<any>[] = [];
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        // Create signals
        const newItems = src.map((item, index) => {
            // TODO: Centralise queue
            console.log(item)
            if (persist) { dbPromises.push(store.add(item)); }
            const signal = createSignal(item);
            this.index.set(item.id, signal);
            return signal[0];
        });
        // TODO: Centralise queue
        Promise.all(dbPromises).catch((err) => console.log(err));
        const newOl = [...this.ol(), ...newItems];
        // Calc sortKeys
        this.setOl(newOl);
    }
    updateName = (id: string, name: string) => {
        const item = this.index.get(id);
        if (item) {
            item[1]((prev) => {
                prev.name = name;
                return prev;
            });
        }
    }
    idb_insert = async(data: BordeContainer | BordeContainer[]) => {
        const tx = this.db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        const insert = async (item: BordeContainer) => {
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
