import { nanoid } from 'nanoid';
import { createSignal, Accessor, Setter } from 'solid-js';
import { store } from './main.js';

export const openLists = new Map<string, FastList>();

export function openList(listId: string) {
    if (openLists.has(listId)) return openLists.get(listId);
    const fastList = new FastList(listId);
    openLists.set(listId, fastList);
    return fastList;
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

// data projection stack
// 1. server (online persistence) -> idb (offline persistence) -> fast list (fast, optimistic access) -> list instance (display, interaction)

export let lastTouchedList: string | false = false;

/**
 * Fast list interaction based on array
 * For editing and sorting lists quickly without the overhead of transactional guarantees from the main store
 * TODO: Strongly consider an index
 */
export class FastList {
    listId: string;
    list: AcmeItem[] = [];
    signal: Accessor<AcmeItem[]>;
    setSignal: Setter<AcmeItem[]>;
    constructor(listId: string) {
        const [signal, setSignal] = createSignal([]);
        this.signal = signal;
        this.setSignal = setSignal;
        this.listId = listId;
        // this.store.subscribe(listId, onUpdate);
        this.initList();
    }
    setLastTouched = () => {
        lastTouchedList = this.listId;
    }
    new(item: AcmeItemInsertion) {
        store.insert({
            id: nanoid(),
            ...item,
            dateCreated: (new Date()).toString(),
        });
    }
    // TODO: Deconflate move / add
    moveItems(ids: Set<string>, targetList: string, between: [string | null, string | null]) {
        // Filter ids from list
        const itemsToMove: AcmeItem[] = [];
        const updatedList = this.signal().filter((item) => {
            const toMove = ids.has(item.id)
            if (toMove) itemsToMove.push(item);
            return !toMove;
        });
        this.setSignal(updatedList);
        const openTargetList = openLists.get(targetList);
        if (openTargetList) {
            openTargetList.add(itemsToMove, between[0]);
        } else {
            // or add directly to store
        }
    }
    // no persistence add
    // todo: performance optimisation, add to sorted list
    add(items: AcmeItem[], at: string | null) {
        // const list = this.signal();
        // list.push(...items);
        // sort ids individually by previous sort order
        // insert between items
        // TODO: calculate sort key
        const l = this.signal();
        const index = l.findIndex((item) => item.id === at);
        l.splice(index + 1, 0, ...items);
        this.setSignal(l);
        // list.sort(() => {
        //     // todo: sort by sortKey + id
        // })
    }
    updateItemContents(id: string, newText: string) {
        // TODO: Move item
        // TODO: Consider maintaining an index
        const index = this.signal().findIndex((item) => item.id === id);
        if (index === -1) return console.error('updateItemContents() index not found');
        this.setSignal((prev) => {
            prev[index].text = newText;
            return prev;
        });
        // TODO: Update idb
    }
    // Track updates, potentially batched
    onUpdate(type: string, items: AcmeItem[]) {
        if (type === 'add') {
            // put into list and sort list
        }
        if (type === 'update') {
            items.forEach(() => {
                // put into list and sort list
            })
        }
        if (type === 'delete') {
            // remove from btree
            // remove from list
        }
        // Trigger signal update
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
