import { createSignal } from 'solid-js';

type ViewState = string[];

/**
 * Views, left to right
 */
export let activeViewIndex = 0;
export const [listViews, setListViews] = createSignal<string[]>(['inbox']);

/**
 * Open list at specified index
 */
export function replaceActiveView(listId: string) {
    return setListViews((prev: ViewState) => {
        const next = [...prev];
        next[activeViewIndex] = listId;
        return next;
    });
}

/**
 * Open list at specified index
 */
export function closeView(index: number) {
    return setListViews((prev: ViewState) => {
        prev.splice(index, 1);
        return [...prev];
    });
}

export function addView(listId: string) {
    // TODO: Allow 100 horizontal lists
    if (listViews.length > 8) return;
    return setListViews((prev: ViewState) => {
        return [...prev, listId];
    })
}