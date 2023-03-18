import { createSignal, createUniqueId } from 'solid-js';

/**
 * Views, left to right
 * State should be saved in local storage, per workspace
 */

export const [activeViewId, setActiveViewId] = createSignal<string | null>(null);
export const [views, setViews] = createSignal<AcmeView[]>([{
    id: createUniqueId(),
    containerId: 'inbox',
    projection: 'list',
}]);

export function findActiveViewIndex() {
    if (!activeViewId()) return false;
    return views().findIndex((view) => view.id === activeViewId());
}

/**
 * Open list at specified index
 */
export function replaceView(containerId: string, index: number = 0) {
    return setViews((prev: AcmeView[]) => {
        const next = [...prev];
        next[index] = {
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