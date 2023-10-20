import { nanoid } from 'nanoid';
import { createSignal, Accessor, Setter } from 'solid-js';
import { store } from './main.js';

export const openLists = new Map<string, FastList>();

export function openList(listId: string) {
    if (openLists.has(listId)) {
        return openLists.get(listId);
    }
    const fastList = new FastList(listId);
    openLists.set(listId, fastList);
    return fastList;
}

// https://github.com/solidjs/solid/discussions/1524
// https://www.reddit.com/r/solidjs/comments/ilebtl/efficient_state_updates_to_arrays/
// https://github.com/solidjs/solid/discussions/366

interface AcmeItemInsertion extends Partial<AcmeContainer> {
    text: string;
    sortKey: string;
    listId: string;
}

export let dragOriginList: string | null = null; // TODO: move to Selection or hybrid

/**
 * Optimistic in-memory list
 * For editing and sorting lists quickly without the overhead of transactional guarantees and sort keys etc from the main store
 * TODO: Strongly consider an index
 * TODO: Handling 3000+ items without log(n) - roll the list DOM patcher yourself
 */
export class FastList {
    listId: string;
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
    setDragOriginList = (listId: string) => {
        dragOriginList = listId;
    }
    new(item: AcmeItemInsertion) {
        store.itemModel.insert({
            id: nanoid(),
            ...item,
            tsCreated: (new Date()).toString(),
            tsCompleted: null,
        });
    }
    // TODO: Optimisation: if only moving, skip first step
    // TODO: Clear selection in source list, create selection in new list
    moveItems(ids: Set<string>, sourceListId: string, between: [string | null, string | null]) {
        // Filter ids from list
        const itemsToMove: AcmeItem[] = [];
        const sourceList = openLists.get(sourceListId);
        if (!sourceList) return; // Should not happen (TODO: Log validation error)
        const updatedList = sourceList.signal().filter((item) => {
            const toMove = ids.has(item.id)
            if (toMove) itemsToMove.push(item);
            return !toMove;
        });
        sourceList.setSignal(updatedList); // Filter out items from source list
        this.add(itemsToMove, between[0]);
    }
    // no persistence add
    // todo: performance optimisation, add to sorted list
    add(items: AcmeItem[], at: string | number | null) {
        const l = this.signal();
        const index = typeof at === 'number' ? at : l.findIndex((item) => item.id === at);
        l.splice(index + 1, 0, ...items);
        this.setSignal([...l]);
    }
    updateItemContents(id: string, attrs: Partial<AcmeItem>) {
        // TODO: Move item
        // TODO: Consider maintaining an index
        const index = this.signal().findIndex((item) => item.id === id);
        if (index === -1) return console.error('updateItemContents() index not found');
        this.setSignal((prev) => {
            Object.assign(prev[index], attrs)
            return prev;
        });
        // TODO: Abstract as action & persist as queue
        store.itemModel.update(id, attrs).then(() => {});
        // TODO: Update idb
    }
    updateItem(id: string, attrs: Partial<AcmeItem>) {
        // TODO: Consider maintaining an index
        const index = this.signal().findIndex((item) => item.id === id);
        if (index === -1) return console.error('updateItemContents() index not found');
        this.setSignal((prev) => {
            Object.assign(prev[index], attrs)
            return prev;
        });
        // TODO: Update idb
    }
    completeItem(id: string) {
        this.updateItemContents(id, { tsCompleted: new Date() })
        // const index = this.signal().findIndex((item) => item.id === id);
        // if (index === -1) return console.error('updateItemContents() index not found');
        // this.setSignal((prev) => {
        //     Object.assign(prev[index], attrs)
        //     return prev;
        // });
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
        const list = await store.itemModel.getItemsByList(this.listId);
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
