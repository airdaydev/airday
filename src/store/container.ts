import { Accessor, createSignal, Setter, Signal } from 'solid-js';
import { store, AcmeIDB, dbNotReadyMessage } from './main';

export const [containers, setContainers] = createSignal<AcmeContainer[]>([]);

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
    ol: Accessor<Accessor<AcmeContainer>[]>;
    setOl: Setter<Accessor<AcmeContainer>[]>;
    index = new Map<string, Signal<AcmeContainer>>();
    map: Map<string, AcmeContainer> = new Map();
    constructor() {
        const signal = createSignal<Accessor<AcmeContainer>[]>([]);
        this.ol = signal[0];
        this.setOl = signal[1];
    }
    init = (db: AcmeIDB) => { this.acmedb = db; }
    ready() { return !!this.db; }
    get db() {
        // TODO: This COULD be made redundant with proper queuing system
        if (!this.acmedb) throw new Error('Item store uninitialised');
        return this.acmedb;
    }
    insert = (data: AcmeContainer | AcmeContainer[]) => {
        // Convert to array
        const src = Array.isArray(data) ? data : [data];
        // Create signals
        const newItems = src.map((item, index) => {
            const signal = createSignal(item);
            this.index.set(item.id, signal);
            return signal[0];
        });
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
