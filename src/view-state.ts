import { createStore } from 'solid-js/store';

type ViewState = string[];

/**
 * Views, left to right
 */
export const [listViews, setListViews] = createStore<string[]>(['inbox', 'acmelist']);

/**
 * Open list at specified index
 */
export function replaceView(index: number, listId: string) {
    return setListViews((prev: ViewState) => {
        const next = [...prev];
        next[index] = listId;
        return next;
    });
}
