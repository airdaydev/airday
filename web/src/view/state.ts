import { createSignal, createUniqueId, Signal, createContext } from "solid-js";
import { GenericItem } from "../store/loader";
import { walk } from "@borde/list";

type ActiveRegionTypes = "sidebar" | "container";
type ModalTypes = "command" | "find" | null;
type SplitDirection = "vertical" | "horizontal";
type ViewType = "container" | "data";
type ViewIndex = [number, number];

export class ViewNode {
  id = createUniqueId();
  isRoot = false;
  type: ViewType = "container";
  direction: SplitDirection = "horizontal";
  children?: Signal<ViewNode[]> = createSignal<ViewNode[]>([]);
  parent?: ViewNode;
  detach() {
    this.parent?.removeView(this);
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
  projection: "list" | "kanban" = "list";
  constructor(containerId: string) {
    super();
    this.containerId = containerId;
  }
}

/**
 * Views
 * pane 0 = sidebar
 * pane 1...9+ = lists
 * default = 1 pane: inbox
 * ⌘+/ = command modal
 * / = find modal
 * State should be saved in local storage, per workspace
 */
class ViewState {
  activeModal: Signal<ModalTypes> = createSignal<ModalTypes>(null);
  activeRegion: Signal<ActiveRegionTypes> =
    createSignal<ActiveRegionTypes>("container");
  activePane = createSignal<ViewNode | undefined>();
  sidebarVisible = createSignal<boolean>(true);
  tree = new RootViewNode();
  scene = createSignal<"default" | "focus">("default");
  focus?: GenericItem;
  constructor() {}
  findNodeById(id: string): ViewNode | null {
    let result: ViewNode | null = null;
    walk(this.tree, (node) => {
      if (node.id === id) {
        result = node;
        return true; // Stop walking
      }
    });
    return result;
  }
  addViewRelative(
    containerId: string,
    relativeTo: string,
    position: "left" | "right" | "up" | "down",
  ) {
    const relativeNode = this.findNodeById(relativeTo);
    if (!relativeNode) return;

    const view = new DataView(containerId);
    switch (position) {
      case "left":
        relativeNode.addLeft(view);
        break;
      case "right":
        relativeNode.addRight(view);
        break;
      case "up":
        relativeNode.addUp(view);
        break;
      case "down":
        relativeNode.addDown(view);
        break;
    }
    this.activePane[1](view.id);
  }

  count() {
    // TODO: This needs to be a signal... so all registered views must be tracked.
    let count = 0;
    walk(this.tree, (node) => {
      count++;
    });
    return count;
  }
  focusItem(item: GenericItem) {
    this.focus = item;
    this.scene[1]("focus");
  }
  // TODO: Review AI gen
  get active() {
    return false;
    // let foundSignal: Signal<DataView> | undefined;
    // let foundRow = -1;
    // let foundCol = -1;

    // this.matrix[0]().some((row, rowIndex) => {
    //   const colIndex = row.findIndex(
    //     (view) => view[0]().id === this.activePaneId(),
    //   );
    //   if (colIndex !== -1) {
    //     foundSignal = row[colIndex];
    //     foundRow = rowIndex;
    //     foundCol = colIndex;
    //     return true;
    //   }
    //   return false;
    // });

    // return {
    //   signal: foundSignal,
    //   row: foundRow,
    //   col: foundCol,
    // };
  }
  isContainerActive(containerId: string) {
    // const activeContainer = this.list[0]().find(
    //   (view) => view[0]().id === this.activePaneId(),
    // );
    // if (!activeContainer) return false;
    // return activeContainer[0]().containerId === containerId;
    return false;
  }
  openDataView(containerId: string) {
    const view = new DataView(containerId);
    const activePane = this.activePane[0]();
    if (activePane) {
      activePane?.replace(view);
    } else {
      this.addViewToRoot(view);
    }
  }
  openDoneView = () => {
    // const id = createUniqueId();
    // const view: BordeDoneView = {
    //   id,
    //   type: "done",
    // };
    // this.addViewToRoot(view);
  };
  addViewToRoot(view: DataView, ViewIndex = [0, 0]) {
    this.tree.addChild(view);
    // this.setActivePaneId(view.id);
  }
  closeView(view: DataView) {
    view.detach();
  }
}

export const viewState = new ViewState();
export const viewContext = createContext<ViewState>(viewState);
