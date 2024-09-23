import {
  createSignal,
  createUniqueId,
  Signal,
  Accessor,
  Setter,
  createContext,
} from "solid-js";
import { GenericItem } from "../store/loader";
import { walk } from "@borde/list";

type ActiveRegionTypes = "sidebar" | "container";
type ModalTypes = "command" | "find" | undefined;
type SplitDirection = "vertical" | "horizontal";
type ViewType = "container" | "data";
type ViewIndex = [number, number];

export class ViewNode {
  id = createUniqueId();
  isRoot = false;
  type: ViewType = "container";
  direction: SplitDirection = "horizontal";
  children: Signal<DataView[]> = createSignal(new Array());
  parent?: ViewNode;
  addChild = (view: DataView, index?: number) => {
    view.parent = this;
    this.children[1]((prev) => [...prev, view]);
  };
  replaceChild = (view: DataView, index: number = 0) => {
    this.children[1]((prev) => {
      const next = [...prev];
      next[index] = view;
      return next;
    });
  };
  removeView = (view: DataView) => {
    this.children[1]((prev) => prev.filter((v) => v.id !== view.id));
  };
  addSibling = (view: DataView) => {
    this.parent?.addChild(view);
  };
}

export class RootViewNode extends ViewNode {
  isRoot = true;
  splitDirection = "horizontal";
}

export class VerticalSplitNode extends ViewNode {
  constructor() {
    super();
    this.type = "container";
    this.direction = "vertical";
  }
}

export class HorizontalSplitNode extends ViewNode {
  constructor() {
    super();
    this.type = "container";
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
  detach() {
    this.parent?.removeView(this);
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
  activeModal: Accessor<ModalTypes>;
  activeRegion: Accessor<ActiveRegionTypes>;
  activePaneId: Accessor<string | undefined>;
  setActivePaneId: Setter<string | undefined>;
  sidebarVisible = createSignal<boolean>(true);
  tree = new RootViewNode();
  scene = createSignal<"default" | "focus">("default");
  focus?: GenericItem;
  constructor() {
    const activeRegion = createSignal<ActiveRegionTypes>("sidebar");
    this.activeRegion = activeRegion[0];
    const activeModal = createSignal<ModalTypes>();
    this.activeModal = activeModal[0];
    const activePaneId = createSignal<string>();
    this.activePaneId = activePaneId[0];
    this.setActivePaneId = activePaneId[1];
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
    this.addViewToRoot(view);
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
    this.setActivePaneId(view.id);
  }
  addHorizontally(containerId: string, ViewIndex = [0, 0]) {
    const view = new DataView(containerId);
    this.tree.addChild(view);
    this.setActivePaneId(view.id);
  }
  addVertically(containerId: string, ViewIndex = [0, 0]) {
    const column = new ColumnNode();
    const view = new DataView(containerId);
    column.addChild(view);
    this.tree.addChild(view);
    this.setActivePaneId(view.id);
  }
  closeView(view: DataView) {
    const [matrix, setMatrix] = this.matrix;
    view.detach();
    // const col = matrix[0]();
    // const view = matrix()[index][0]().id;
    // if (!view) return;
    // return setMatrix((prev) => {
    //   prev.splice(index, 1);
    //   return [...prev];
    // });
  }
}

export const viewState = new ViewState();
export const viewContext = createContext<ViewState>(viewState);
