import {
    createSignal, createUniqueId, Signal,
    Accessor, Setter,
} from 'solid-js';

/**
 * Views, left to right
 * State should be saved in local storage, per workspace
 */
class ViewState {
    activeViewId: Accessor<string | undefined>;
    setActiveViewId: Setter<string | undefined>;
    sidebarVisible = createSignal<boolean>(true);
    list = createSignal<Signal<AcmeView>[]>([]);
    constructor() {
        const activeView = createSignal<string>();
        this.activeViewId = activeView[0];
        this.setActiveViewId = activeView[1];
        if (!this.list[0]().length) {
            // this.addContainerView('inbox');
        }
    }
    get active() {
        const index = this.list[0]().findIndex((view) => view[0]().id === this.activeViewId());
        return {
            signal: this.list[0]()[index],
            index: index < 0 ? 0 : index,
        };
    }
    isContainerActive(containerId: string) {
        const activeContainer = this.list[0]().find((view) => view[0]().id === this.activeViewId());
        if (!activeContainer) return false;
        return activeContainer[0]().containerId === containerId;
    }
    // TODO: argument should be view, create view and pass into this
    replaceActiveViewWithContainer(containerId: string) {
        this.openContainerViewAt(containerId, viewState.active.index || 0);
    }
    openContainerViewAt = (containerId: string, index: number = 0) => {
        const id = createUniqueId(); // TODO: How does uniqueness work here
        const newView = createSignal<AcmeContainerView>({
            id,
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
        this.setActiveViewId(id);
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
    addContainerView = (containerId: string) => {
        // TODO: Allow more lists
        if (this.list[0]().length > 8) return;
        const id = createUniqueId();
        const view = createSignal<AcmeContainerView>({
            // TODO: Detect clash / or how does this lib work
            id,
            type: 'container',
            containerId,
            projection: 'list',
        });
        this.setActiveViewId(id);
        const [list, setList] = this.list;
        return setList((prev) => {
            return [...prev, view];
        })
    }
}

export const viewState = new ViewState();
