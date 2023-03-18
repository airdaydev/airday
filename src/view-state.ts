import { createSignal, createUniqueId } from 'solid-js';



/**
 * Views, left to right
 * State should be saved in local storage
 */
export let activeViewIndex = 0;
export const [views, setViews] = createSignal<AcmeView[]>([{
    id: createUniqueId(),
    containerId: 'inbox',
    projection: 'list',
}]);

/**
 * Open list at specified index
 */
export function replaceActiveView(containerId: string) {
    return setViews((prev: AcmeView[]) => {
        const next = [...prev];
        next[activeViewIndex] = {
            id: createUniqueId(),
            containerId,
            projection: 'list',
        };
        return next;
    });
}

/**
 * Open list at specified index
 */
export function closeView(index: number) {
    return setViews((prev: AcmeView[]) => {
        prev.splice(index, 1);
        return [...prev];
    });
}

export function addView(containerId: string) {
    // TODO: Allow 100 horizontal lists
    if (views.length > 8) return;
    const view: AcmeView = {
        // TODO: Detect clash / or how does this lib work
        id: createUniqueId(),
        containerId,
        projection: 'list',
    }
    return setViews((prev) => {
        return [...prev, view];
    })
}