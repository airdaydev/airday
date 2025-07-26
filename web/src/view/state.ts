import { createSignal, createUniqueId, Signal, createContext } from "solid-js";
import { GenericItem } from "../store/item";
import { AirWorkspace } from "../store/main";
import { KeyboardShortcuts } from "./keyboard";

type ActiveRegionType = "sidebar" | "container";
type ModalTypes = "command" | "find" | null;
type ViewType = "container" | "data";
type DataViewType = "list" | "done" | "calendar";

export class Views {
  children: Signal<ViewNode[]> = createSignal<ViewNode[]>([]);
  addChild(view: ViewNode, index?: number) {
    this.children[1]((prev) => {
      const next = [...prev];
      if (index !== undefined) {
        next.splice(index, 0, view);
      } else {
        next.push(view);
      }
      return next;
    });
  }
  findNodeById(id: string): ViewNode | undefined {
    return this.children[0]().find((node) => {
      if (node.id === id) {
        return node;
      }
    });
  }
  findNodeIndexById(id: string): number | undefined {
    return this.children[0]().findIndex((node) => {
      if (node.id === id) {
        return node;
      }
    });
  }
  count() {
    return this.children[0]().length;
  }
  replaceChild = (view: ViewNode, index: number = 0) => {
    view.parent = this;
    this.children[1]((prev) => {
      const next = [...prev];
      next[index] = view;
      return next;
    });
  };
  removeView = (view: ViewNode) => {
    this.children[1]((prev) => {
      const next = prev.filter((v) => v.id !== view.id);
      return next;
    });
  };
}

// TODO: Replace tree with a simple arra, and create workspaces!
export class ViewNode {
  id = createUniqueId();
  type: ViewType = "container";
  parent: Views;
  viewState: ViewState;
  constructor(viewState: ViewState) {
    this.viewState = viewState;
    this.parent = this.viewState.views;
  }
  detach() {
    this.parent?.removeView(this);
  }
  get title(): string | false {
    return false;
  }
  setDocumentTitle() {
    const titleText = this.title;
    if (titleText) {
      document.title = `${titleText} - Airday`;
      return;
    }
    document.title = "Airday";
  }
  replace = (view: ViewNode) => {
    const index = this.parent.findNodeIndexById(this.id);
    this.parent.replaceChild(view, index);
  };
  addLeft(view: ViewNode) {
    this.addSibling(view, "before");
  }
  addRight(view: ViewNode) {
    this.addSibling(view, "after");
  }
  addSibling(view: ViewNode, position: "before" | "after") {
    const ogParent = this.parent;
    const thisIndex = ogParent.children[0]().indexOf(this);
    const newIndex = position === "before" ? thisIndex : thisIndex + 1;
    ogParent.addChild(view, newIndex);
  }
  // TODO: separate get next / get prev functions
  getSibling(direction: "left" | "right"): ViewNode | null {
    const index = this.parent.findNodeIndexById(this.id);
    if (!index) return null;
    const siblings = this.parent.children?.[0]() || [];

    let nextSibling: ViewNode | null = null;

    const getNextSibling = (increment: number) => {
      let nextIndex = (index + increment + siblings.length) % siblings.length;
      return siblings[nextIndex];
    };

    if (direction === "left") {
      nextSibling = getNextSibling(-1);
    } else if (direction === "right") {
      nextSibling = getNextSibling(1);
    }

    if (nextSibling) {
      return nextSibling;
    }
    return null;
  }
}

export class DoneView extends ViewNode {
  type: ViewType = "data";
  dataType: DataViewType = "done";
  constructor(viewState: ViewState) {
    super(viewState);
  }
  get title() {
    return "Done";
  }
  duplicate() {
    return new DoneView(this.viewState);
  }
}

export class CalendarView extends ViewNode {
  type: ViewType = "data";
  dataType: DataViewType = "calendar";
  constructor(viewState: ViewState) {
    super(viewState);
  }
  get title() {
    return "Calendar";
  }
  duplicate() {
    return new DoneView(this.viewState);
  }
}

export class UpNextView extends ViewNode {
  type: ViewType = "data";
  dataType: DataViewType = "done";
  constructor(viewState: ViewState) {
    super(viewState);
  }
  get title() {
    return "Next";
  }
  duplicate() {
    return new UpNextView(this.viewState);
  }
}

export class DataView extends ViewNode {
  id = createUniqueId();
  containerId: string;
  type: ViewType = "data";
  dataType: DataViewType = "list";
  projection: "list" | "kanban" = "list";
  constructor(viewState: ViewState, containerId: string) {
    super(viewState);
    this.containerId = containerId;
  }
  get title(): false {
    const containerNode =
      this.viewState.workspace.containerStore.tree.idMap.get(this.containerId);
    if (!containerNode) return false;
    return containerNode.name;
  }
  duplicate() {
    return new DataView(this.viewState, this.containerId);
  }
}

type Scene = "default" | "focus";

/**
 * Views
 * pane 0 = sidebar
 * pane 1...9+ = lists
 * default = 1 pane: inbox
 * ⌘+/ = command modal
 * / = find modal
 * State should be saved in local storage, per workspace
 */
export class ViewState {
  activeModal: Signal<ModalTypes> = createSignal<ModalTypes>(null);
  activeRegion: Signal<ActiveRegionType> =
    createSignal<ActiveRegionType>("container");
  activePane = createSignal<ViewNode | undefined>();
  sidebarVisible = createSignal<boolean>(true);
  views = new Views();
  scene = createSignal<Scene>("default");
  focus?: GenericItem;
  workspace: AirWorkspace;
  keyboard: KeyboardShortcuts;
  paneDropView?: ViewNode; // This is the currently selected pane being dragged
  constructor(workspace: AirWorkspace) {
    this.workspace = workspace;
    this.keyboard = new KeyboardShortcuts(workspace, this);
  }
  count() {
    return this.views.count();
  }
  toggleSidebar() {
    this.sidebarVisible[1]((prev) => !prev);
  }
  focusSidebar() {
    this.activeRegion[1]("sidebar");
  }
  focusContainer() {
    this.activeRegion[1]("container");
    // TODO: Consider investigating for smell
    // the dnd isn't ready when list is prepared
    const dnd = this.workspace.containerStore.getNavDnd();
    if (dnd) dnd.clearSelection();
  }
  openFocusScene() {
    this.scene[1]("focus");
  }
  openDefaultScene() {
    this.scene[1]("default");
    const t = this.workspace.dndContext.focusedContext();
    if (this.focus) t?.selectOne(this.focus);
  }
  setActivePane(view: ViewNode) {
    this.focusContainer();
    this.activePane[1](view);
    view.setDocumentTitle();
  }
  setActiveRegion(region: ActiveRegionType) {
    this.activeRegion[1](region);
    if (region === "container") {
    }
  }
  addViewRelative(
    view: DataView | DoneView,
    relativeTo: string,
    position: "left" | "right",
  ) {
    const relativeNode = this.parent.findNodeById(relativeTo);
    if (!relativeNode) return;

    const newView = view.duplicate();
    switch (position) {
      case "left":
        relativeNode.addLeft(newView);
        break;
      case "right":
        relativeNode.addRight(newView);
        break;
    }
    this.setActivePane(newView);
  }
  focusItem(item: GenericItem) {
    this.focus = item;
    this.openFocusScene();
  }
  openDataView(containerId: string) {
    this.openView(new DataView(this, containerId));
  }
  openDoneView = () => {
    this.openView(new DoneView(this));
  };
  openCalendarView = () => {
    this.openView(new CalendarView(this));
  };
  openUpNextView = () => {
    this.openView(new UpNextView(this));
  };
  openView = (view: ViewNode) => {
    const activePane = this.activePane[0]();
    if (activePane) {
      activePane?.replace(view);
      this.setActivePane(view);
    } else {
      this.addViewToRoot(view);
    }
  };
  addViewToRoot(view: ViewNode, ViewIndex = [0, 0]) {
    this.views.addChild(view);
  }
  closeView(view: DataView) {
    view.detach();
  }
}

export const viewContext = createContext<ViewState>();
