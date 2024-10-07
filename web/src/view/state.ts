import { createSignal, createUniqueId, Signal, createContext } from "solid-js";
import { GenericItem } from "../store/item";
import { SunlistWorkspace } from "../store/main";
import { KeyboardShortcuts } from "./keyboard";

type ActiveRegionType = "sidebar" | "container";
type ModalTypes = "command" | "find" | null;
type SplitDirection = "vertical" | "horizontal";
type ViewType = "container" | "data";
type DataViewType = "list" | "done";

export interface SignalNode<T extends SignalNode<any | undefined>> {
  children?: Signal<T[]>;
}

/**
 * Walks through nodes with children signal
 */
export function signalWalk<
  T extends SignalNode<any>,
  O extends SignalNode<any>,
>(node: T, func: (node: T, parent?: O) => boolean | void, parent?: O) {
  const skipChildren = func(node, parent);
  if (skipChildren) return;
  if (node.children)
    node.children[0]().forEach((child) => signalWalk(child, func, parent));
}

export class ViewNode {
  id = createUniqueId();
  isRoot = false;
  type: ViewType = "container";
  direction: SplitDirection = "horizontal";
  children?: Signal<ViewNode[]> = createSignal<ViewNode[]>([]);
  parent?: ViewNode;
  viewState: ViewState;
  constructor(viewState: ViewState) {
    this.viewState = viewState;
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
      document.title = `${titleText} - Sunlist`;
      return;
    }
    document.title = "Sunlist";
  }
  getIndexShallow() {
    if (!this.parent) return -1;
    return this.parent.children[0]().findIndex((node) => node === this);
  }
  replace = (view: ViewNode) => {
    const index = this.getIndexShallow();
    this.parent?.replaceChild(view, index);
  };
  replaceChild = (view: ViewNode, index: number = 0) => {
    view.parent = this;
    this.children[1]((prev) => {
      const next = [...prev];
      next[index] = view;
      return next;
    });
  };
  // TODO: AI written; review
  removeView = (view: ViewNode) => {
    this.children[1]((prev) => {
      const next = prev.filter((v) => v.id !== view.id);
      if (next.length === 0 && this.type === "container" && this.parent) {
        this.parent.removeView(this);
      }
      return next;
    });
  };
  addChild(view: ViewNode, index?: number) {
    view.parent = this;
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
  addLeft(view: ViewNode) {
    if (!this.parent) return;
    const ogParent = this.parent;
    const thisIndex = ogParent.children[0]().indexOf(this);
    if (this.parent.direction === "horizontal") {
      this.addSibling(view, "before");
    } else {
      const horzSplit = new HorizontalSplitNode();
      horzSplit.addChild(view);
      horzSplit.addChild(this);
      ogParent.replaceChild(horzSplit, thisIndex);
    }
  }
  addRight(view: ViewNode) {
    if (!this.parent) return;
    const ogParent = this.parent;
    const thisIndex = ogParent.children[0]().indexOf(this);
    if (this.parent.direction === "horizontal") {
      this.addSibling(view, "after");
    } else {
      const horzSplit = new HorizontalSplitNode();
      horzSplit.addChild(this);
      horzSplit.addChild(view);
      ogParent.replaceChild(horzSplit, thisIndex);
    }
  }
  addSibling(view: ViewNode, position: "before" | "after") {
    if (!this.parent) return;
    const ogParent = this.parent;
    const thisIndex = ogParent.children[0]().indexOf(this);
    const newIndex = position === "before" ? thisIndex : thisIndex + 1;
    ogParent.addChild(view, newIndex);
  }
  addUp(view: ViewNode) {
    if (!this.parent) return;
    const ogParent = this.parent;
    const thisIndex = ogParent.children[0]().indexOf(this);
    if (this.parent.direction === "vertical") {
      this.addSibling(view, "before");
    } else {
      const vertSplit = new VerticalSplitNode();
      vertSplit.addChild(view);
      vertSplit.addChild(this);
      // TODO: Method this
      ogParent.replaceChild(vertSplit, thisIndex);
    }
  }
  addDown(view: ViewNode) {
    if (!this.parent) return;
    const ogParent = this.parent;
    const thisIndex = ogParent.children[0]().indexOf(this);
    if (this.parent.direction === "vertical") {
      this.addSibling(view, "after");
    } else {
      const vertSplit = new VerticalSplitNode();
      vertSplit.addChild(this);
      vertSplit.addChild(view);
      ogParent.replaceChild(vertSplit, thisIndex);
    }
  }
}

export class RootViewNode extends ViewNode {
  isRoot = true;
  splitDirection = "horizontal";
}

export class VerticalSplitNode extends ViewNode {
  constructor() {
    super();
    this.direction = "vertical";
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

export class HorizontalSplitNode extends ViewNode {
  constructor() {
    super();
    this.direction = "horizontal";
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
  tree = new RootViewNode();
  scene = createSignal<Scene>("default");
  focus?: GenericItem;
  workspace: SunlistWorkspace;
  keyboard: KeyboardShortcuts;
  paneDropView?: ViewNode; // This is the currently selected pane being dragged
  constructor(workspace: SunlistWorkspace) {
    this.workspace = workspace;
    this.keyboard = new KeyboardShortcuts(workspace, this);
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
  findNodeById(id: string): ViewNode | null {
    let result: ViewNode | null = null;
    signalWalk(this.tree, (node) => {
      if (node.id === id) {
        result = node;
        return true; // Stop signalWalking
      }
    });
    return result;
  }
  addViewRelative(
    view: DataView | DoneView,
    relativeTo: string,
    position: "left" | "right" | "up" | "down",
  ) {
    const relativeNode = this.findNodeById(relativeTo);
    if (!relativeNode) return;

    const newView = view.duplicate();
    switch (position) {
      case "left":
        relativeNode.addLeft(newView);
        break;
      case "right":
        relativeNode.addRight(newView);
        break;
      case "up":
        relativeNode.addUp(newView);
        break;
      case "down":
        relativeNode.addDown(newView);
        break;
    }
    this.setActivePane(newView);
  }

  count() {
    let count = 0;
    signalWalk(this.tree, (node) => {
      if (node.type !== "container") count++;
    });
    return count;
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
    this.tree.addChild(view);
  }
  closeView(view: DataView) {
    view.detach();
  }
}

export const viewContext = createContext<ViewState>();
