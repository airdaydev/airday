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
    /**
     * 
     * @param start inclusive start
     * @param end inclusive end
     */
    getKeysInRange(start: number, end: number) {
        return this.signal().slice(start, end + 1).map((item) => item.id);
    }
    getIndexOfKey(key: string) {
        const list = this.signal();
        const originIndex = list.findIndex((item) => {
            return item.id === key
        });
        if (originIndex === -1) return false;
        return originIndex;
    }
    getNeighbourIndex(key: string, direction: ListDirection = 'next') {
        const list = this.signal();
        const vector = direction === 'next' ? 1 : -1;
        const originIndex = list.findIndex((item) => {
            return item.id === key
        });
        const nextIndex = originIndex + vector;
        return list[nextIndex] ? nextIndex : false;
    }
    getLastIndexOfSet(keySet: Set<string>) {
        // TODO: We could collect all sortkeys through an up-to-date hashmap
        const list = this.signal();
        for (let i = list.length - 1; i >= 0; i--) {
            if (keySet.has(list[i].id)) return i;
        }
        return false;
    }
    getFirstIndexOfSet(keySet: Set<string>) {
        // TODO: We could collect all sortkeys through an up-to-date hashmap
        const list = this.signal();
        for (let i = 0; i < list.length; i++) {
            if (keySet.has(list[i].id)) return i;
        }
        return false;
    }
    getNextNotInSet(originIndex: number, keySet: Set<string>, direction: 'next' | 'prev' = 'next') {
        const list = this.signal();
        let rangeEnded = false;
        let i = originIndex;
        while (!rangeEnded) {
            const next = list[i];
            if (!next) return false;
            if (keySet.has(next.id)) {
                direction === 'next' ? i++ : i--;
            } else {
                return i;
            }
        }
        return false;
    }
}
