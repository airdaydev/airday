import { createSignal, Accessor, Setter } from 'solid-js';
// Transient state outside of solidjs lifecycle
// Custom differ for removing past selection states & creating new ones
// Tracking ids or indexes or ranges of indexes

// If a key is added or removed whilst a user is selecting, index mapping would need manual adjustment
// index -> range

// Track IDs and when patching, resolve to

// DOM patcher: find by ID and update (less memory, maybe more complex)
// VS state tracker + signal (more memory, maybe less complex - still have to crawl through list somehow)

type SubscriptionFunc = (selected: boolean) => void;

// Only one "dragging" state at a time (mouse down - dragging, mouse up - no dragging - no opportunity to drag in between)
export let dragOriginSelection: AcmeReactiveSelection | null = null;
const [globalIsDragging, setGlobalIsDragging] = createSignal<boolean>(false);
export let globalLastDisplayIndex: number | false = 0;

// TODO: Consider moving display list logic in here, don't worry about agnostic selection
export class AcmeReactiveSelection {
    keys = new Set<string>;
    subscribers = new Map<string, Set<SubscriptionFunc>>(); // key, set of callbacks i.e. signal update
    rangeOrigin: string | null = null;
    lastKeySelected: string | null = null;
    isDragging: Accessor<boolean>;
    setDraggingInternal: Setter<boolean>;
    lastTouchedIndex: Accessor<number | boolean>;
    setLastTouchedIndexInternal: Setter<number | boolean>;
    globalIsDragging = globalIsDragging;
    constructor() {
        const draggingSignal = createSignal<boolean>(false);
        this.isDragging = draggingSignal[0];
        this.setDraggingInternal = draggingSignal[1];
        const lastTouchedIndex = createSignal<number | boolean>(false);
        this.lastTouchedIndex = lastTouchedIndex[0];
        this.setLastTouchedIndexInternal = lastTouchedIndex[1];
    }
    setLastTouchedIndex = (index: number | false) => {
        this.setLastTouchedIndexInternal(index);
        globalLastDisplayIndex = index;
    }
    setDragging = (isDragging: boolean) => {
        dragOriginSelection = this;
        setGlobalIsDragging(isDragging);
        // TODO: potentially don't need this as a signal (tbc)
        this.setDraggingInternal(isDragging);
    }
    addKey(key: string) {
        this.keys.add(key);
        this.publishToAllSelected()
        this.lastKeySelected = key;
    }
    publishToAllSelected() {
        this.keys.forEach((key) => {
            this.subscribers.get(key)?.forEach(cb => cb(true));
        })
    }
    addKeys(keys: string[]) {
        keys.forEach((key) => this.keys.add(key));
        this.lastKeySelected = keys[keys.length - 1];
        this.publishToAllSelected();
    }
    toggleKey(key: string) {
        if (this.keys.has(key)) {
            this.removeKey(key);
        } else {
            this.rangeOrigin = key;
            this.addKey(key);
        }
    }
    removeKey(key: string) {
        this.keys.delete(key);
        const subscriptions = this.subscribers.get(key);
        subscriptions?.forEach((cb) => cb(false));
    }
    clear() {
        this.rangeOrigin = null;
        this.lastKeySelected = null;
        this.removeKeys(Array.from(this.keys));
    }
    removeKeys(items: string[]) {
        items.map((i) => this.removeKey(i));
    }
    getSignalByKey(key: string): [Accessor<boolean>, () => void] {
        const [selected, setSelected] = createSignal(this.keys.has(key));
        this.subscribe(key, setSelected);
        return [selected, () => this.unsubscribe(key, setSelected)];
    }
    subscribe(key: string, callback: SubscriptionFunc) {
        let set = this.subscribers.get(key);
        if (!set) {
            set = new Set();
            this.subscribers.set(key, set);
        }
        set.add(callback);
        return;
    };
    /**
     * Deselects all other items and selects only one
     */
    selectOne = (key: string) => {
        this.keys.forEach(key => this.removeKey(key));
        this.addKey(key);
        this.rangeOrigin = key;
        this.lastKeySelected = key;
    }
    // Index or item? (pros + cons?)
    selectRange = (from: BordeItem | number, to: BordeItem | number) => {}
    // Up, Down, 1 or to the extents
    // If sticky & in a contiguous region (i.e. if next already selected), jump to bottom (worst case could be O(n with idb lookup for EACH) - if toggling at the top of a list and going down)
    // we could index the index.....
    // Fast finding -> 1. Binary Search, 2. Go to cursor in sorted index and look down or up (consider leaving up to list implementer? but provide helper  functions)
    selectNext = (direction: 'down' | 'up' = 'down', sticky: boolean = false) => {}
    unsubscribe(key: string, callback: SubscriptionFunc) {
        let set = this.subscribers.get(key);
        set?.delete(callback);
    }
}
