import { nanoid } from 'nanoid';
import { createSignal, Accessor, Setter, Signal } from 'solid-js';
import { store } from './main.js';

// https://github.com/solidjs/solid/discussions/1524
// https://www.reddit.com/r/solidjs/comments/ilebtl/efficient_state_updates_to_arrays/
// https://github.com/solidjs/solid/discussions/366

interface BordeItemInsertion extends Partial<BordeContainer> {
    text: string;
    sortKey: string;
    listId: string;
}

export let dragOriginList: string | null = null; // TODO: move to Selection or hybrid

type FastListType = 'trash' | 'upNext' | 'container' | 'done';

/**
 * Optimistic in-memory list
 * For editing and sorting lists quickly without the overhead of transactional guarantees and sort keys etc from the main store
 * TODO: Strongly consider an index
 * TODO: Handling 3000+ items without log(n) - roll the list DOM patcher yourself
 */
export abstract class FastList {
    abstract type: FastListType | null;
    createItems: boolean = false; // Can items be created under this list
    sortable: boolean = false;
    signal: Signal<string[]>; // just the id
    index: Record<string, Signal<BordeItem>> = {};
    constructor() {
        this.signal = createSignal<string[]>([]);
        console.log('fast list init')
        // this.store.subscribe(listId, onUpdate);
    }
    load() {
        console.log('load() not yet implemented');
    }
    setDragOriginList = (listId: string) => {
        dragOriginList = listId;
    }
    new(item: BordeItemInsertion) {
        store.itemModel.insert({
          id: nanoid(),
          ...item,
          tsCreated: new Date(),
          tsCompleted: null,
        });
    }
    // TODO: Optimisation: if only moving, skip first step
    // TODO: Clear selection in source list, create selection in new list
    moveItems(ids: Set<string>, sourceListId: string, between: [string | null, string | null]) {
        // Filter ids from list
        const itemsToMove: BordeItem[] = [];
        const sourceList = openLists.get(`c#${sourceListId}`);
        if (!sourceList) return; // Should not happen (TODO: Log validation error)
        // TODO: Sort memory leak! (redundant/garbage id-indexes)
        const updatedList = sourceList.signal[0]().filter((id) => {
            const toMove = ids.has(id)
            if (toMove) itemsToMove.push(sourceList.getItem(id));
            return !toMove;
        });
        // TODO: No need to unwrap & create new signal!
        itemsToMove.map((i) => console.log(i[0]()))
        console.log('between[0]', between[0])
        console.log('updateList[0]', updatedList)
        sourceList.signal[1](updatedList); // Filter out items from source list
        this.add(itemsToMove, between[0]);
    }
    // no persistence add
    // todo: performance optimisation, add to sorted list
    add(items: BordeItem[], at: string | number | null) {
        const list = this.signal[0]();
        const index = typeof at === 'number' ? at : list.findIndex((id) => id === at);
        list.splice(index + 1, 0, ...items.map((item) => item.id));
        items.map((item) => { this.index[item.id] = createSignal(item); })
        this.signal[1]([...list]);
    }
    onComplete(id: string) {
        // 1. After 3 seconds, update fast list (move into done list)
        // 2. 
    }
    getItem(id: string) {
      return this.index[id];
    }
    updateItemContents(id: string, attrs: Partial<BordeItem>) {
        // TODO: Move item
        // TODO: Consider maintaining an index
        const itemSignal = this.getItem(id);
        if (!itemSignal) return console.error('updateItemContents() index not found');
        itemSignal[1]((val) => Object.assign({}, val, attrs));
        // TODO: Abstract as action & persist as queue
        store.itemModel.update(id, attrs).then(() => {});
        // TODO: Update idb
    }
    completeItem(id: string, tsCompleted: Date | null ) {
        this.updateItemContents(id, { tsCompleted })
    }
    // Track updates, potentially batched
    onUpdate(type: string, items: BordeItem[]) {
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
    /**
     * 
     * @param start inclusive start
     * @param end inclusive end
     */
    getKeysInRange(start: number, end: number) {
        return this.signal[0]().slice(start, end + 1).map((id) => id);
    }
    getIndexOfKey(key: string) {
        const list = this.signal[0]();
        const originIndex = list.findIndex((id) => {
            return id === key
        });
        if (originIndex === -1) return false;
        return originIndex;
    }
    getNeighbourIndex(key: string, direction: ListDirection = 'next') {
        const list = this.signal[0]();
        const vector = direction === 'next' ? 1 : -1;
        const originIndex = list.findIndex((id) => {
            return id === key
        });
        const nextIndex = originIndex + vector;
        return list[nextIndex] ? nextIndex : false;
    }
    getLastIndexOfSet(keySet: Set<string>) {
        // TODO: We could collect all sortkeys through an up-to-date hashmap
        const list = this.signal[0]();
        for (let i = list.length - 1; i >= 0; i--) {
            if (keySet.has(list[i])) return i;
        }
        return false;
    }
    getFirstIndexOfSet(keySet: Set<string>) {
        // TODO: We could collect all sortkeys through an up-to-date hashmap
        const list = this.signal[0]();
        for (let i = 0; i < list.length; i++) {
            if (keySet.has(list[i])) return i;
        }
        return false;
    }
    getNextNotInSet(originIndex: number, keySet: Set<string>, direction: 'next' | 'prev' = 'next') {
        const list = this.signal[0]();
        let rangeEnded = false;
        let i = originIndex;
        while (!rangeEnded) {
            const next = list[i];
            if (!next) return false;
            if (keySet.has(next)) {
                direction === 'next' ? i++ : i--;
            } else {
                return i;
            }
        }
        return false;
    }
}

// Fast list variant for showing up next items
export class UpNextFL extends FastList {
    type: FastListType = 'upNext';
    createItems = true;
    sortable = true;
    // - All items are by reference only
    // - New items go to index
    constructor() {
        super();
    }
}

// Container items
export class ContainerFL extends FastList {
    type: FastListType = 'container';
    listId: string;
    createItems = true;
    sortable = true;
    constructor(listId: string) {
        super();
        this.listId = listId;
        this.load();
    }
    async initList() {
    }
    async load() {
        const list = await store.itemModel.getItemsByList(this.listId);
        // id index must be populated first
        list.map((item) => {
          this.index[item.id] = createSignal(item);
        });
        if (this.signal) this.signal[1](list.map((item) => item.id));
    }
}

// Trash list
export class TrashFL extends FastList {
    type: FastListType = 'trash';
    createItems = false;
    sortable = false;
    constructor() {
        super();
    }
}

/**
 * Fast list variant for showing completed items
 */
export class DoneFL extends FastList {
    type: FastListType = 'done';
    createItems = true;
    sortable = false;
    constructor() {
        super();
        this.load();
    }
    async load() {
        const list = await store.itemModel.getCompletedItems(new Date());
        // id index must be populated first
        list.map((item) => {
          this.index[item.id] = createSignal(item);
        });
        if (this.signal) this.signal[1](list.map((item) => item.id));
    }
    // Completing an item moves it to its original list, or inbox if not found
    // Dropping drops on top of the list (generally, due to time deleted)
}

export const openLists = new Map<string, FastList>();

export function openFastList(view: BordeView): FastList {
    let identifier = null;
    let fastList = null;
    if (view.type === 'container') {
        identifier = `c#${view.containerId}`;
        fastList = openLists.get(identifier);
        if (!fastList) {
            fastList = new ContainerFL(view.containerId);
            openLists.set(identifier, fastList);
        }
    }
    if (view.type === 'done') {
        identifier = 'done';
        fastList = openLists.get(identifier);
        if (!fastList) {
            fastList = new DoneFL();
            openLists.set(identifier, fastList);
        }
    }
    if (!fastList) throw new Error('Cannot determine list from view');
    return fastList;
}
