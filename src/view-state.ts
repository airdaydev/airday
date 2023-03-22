import { createSignal, createUniqueId, Signal } from 'solid-js';

/**
 * Views, left to right
 * State should be saved in local storage, per workspace
 */
class ViewState {
    list = createSignal<Signal<AcmeView>[]>([]);
    activeViewId: string | undefined;
    constructor() {
        if (!this.list[0]().length) {
            this.addContainerView('inbox');
        }
    }
    get active() {
        const index = this.list[0]().findIndex((view) => view[0]().id === this.activeViewId);
        return {
            signal: this.list[0]()[index],
            index: index < 0 ? 0 : index,
        };
    }
    replaceActiveView(containerId: string) {
        this.openContainerViewAt(containerId, viewState.active.index || 0);
    }
    openContainerViewAt(containerId: string, index: number = 0) {
        const newView = createSignal<AcmeContainerView>({
            id: createUniqueId(),
            type: 'container',
            containerId,
            projection: 'list',
        });
        const [list, setList] = this.list;
        setList((prev) => {
            const next = [...prev];
            next[index] = newView;
            return next;
        });
        this.activeViewId = newView[0]().id;
    }
    closeView(index: number) {
        // TODO: if active view, remove active view (does it matter?)
        const [list, setList] = this.list;
        const view = list()[index][0]().id;
        if (!view) return;
        return setList((prev) => {
            prev.splice(index, 1);
            return [...prev];
        });
    }
    addContainerView(containerId: string) {
        // TODO: Allow more lists
        if (this.list[0]().length > 8) return;
        const view = createSignal<AcmeContainerView>({
            // TODO: Detect clash / or how does this lib work
            id: createUniqueId(),
            type: 'container',
            containerId,
            projection: 'list',
        });
        const [list, setList] = this.list;
        return setList((prev) => {
            return [...prev, view];
        })
    }
}

export const viewState = new ViewState();
