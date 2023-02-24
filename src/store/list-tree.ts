import { nanoid } from 'nanoid';
import { createSignal, Accessor, Setter } from 'solid-js';
import { store } from './main.js';

export const openLists = new Map<string, LiveList>();

export function openList(listId: string) {
    if (openLists.has(listId)) return openLists.get(listId);
    const liveList = new LiveList(listId);
    openLists.set(listId, liveList);
    return liveList;
}

// https://github.com/solidjs/solid/discussions/1524
// https://www.reddit.com/r/solidjs/comments/ilebtl/efficient_state_updates_to_arrays/
// https://github.com/solidjs/solid/discussions/366
// SIT ON THIS ONE.
// Maybe the answer here is to use both a list (ordered updates) & a store (finegrained updates)
// OR just creating a signal within the item via a key (similar to selection) (yeah i like this)

interface AcmeItemInsertion extends Partial<AcmeList> {
    text: string;
    sortKey: string;
    listId: string;
}

/**
 * Live list interaction based on array + index (btree)
 * For editing and sorting lists quickly without the overhead of transactional guarantees from the main store
 */
export class LiveList {
    listId: string;
    list: AcmeItem[] = [];
    bTree = null; // or just a hash map?
    signal: Accessor<AcmeItem[]>;
    setSignal: Setter<AcmeItem[]>;
    constructor(listId: string) {
        const [signal, setSignal] = createSignal([]);
        this.signal = signal;
        this.setSignal = setSignal;
        this.listId = listId;
        // this.store.subscribe(listId, onUpdate);
        this.initBTree();
        this.initList();
    }
    new(item: AcmeItemInsertion) {
        store.insert({
            id: nanoid(),
            ...item,
            dateCreated: (new Date()).toString(),
        });
    }
    // Track updates, potentially batched
    onUpdate(type: string, items: AcmeItem[]) {
        if (type === 'add') {
            // add to btree
            // put into list and sort list
        }
        if (type === 'update') {
            items.forEach(() => {
                // add to btree
                // put into list and sort list
            })
        }
        if (type === 'delete') {
            // remove from btree
            // remove from list
        }
        // Trigger signal update
    }
    initBTree() {

    }
    async initList() {
        const list = await store.getItemsByList(this.listId);
        if (this.setSignal) this.setSignal(list);
    }
    getSignal() {
        
    }
    getNeighbour(key: string, direction: ListDirection = 'next') {
        const vector = direction === 'next' ? 1 : -1;
        const originIndex = this.signal().findIndex((item) => {
            return item.id === key
        });
        return this.signal()[originIndex + vector] || false;
    }
}
