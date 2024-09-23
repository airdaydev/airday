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

class ViewNode {
  id = createUniqueId();
  children: Signal<ContainerView[]> = createSignal(new Array());
  parent?: ViewNode;
  addChild = (view: ContainerView, index?: number) => {
    view.parent = this;
    this.children[1]((prev) => [...prev, view]);
  };
  replaceChild = (view: ContainerView, index: number = 0) => {
    this.children[1]((prev) => {
      const next = [...prev];
      next[index] = view;
      return next;
    });
  };
  removeView = (view: ContainerView) => {
    this.children[1]((prev) => prev.filter((v) => v.id !== view.id));
  };
  addSibling = (view: ContainerView) => {
    this.parent?.addChild(view);
  };
}

class RootViewNode extends ViewNode {
  type = "root";
}

export class ContainerView extends ViewNode {
  id = createUniqueId();
  containerId: string;
  type: "container" = "container";
  projection: "list" | "kanban" = "list";
  constructor(containerId: string) {
    super();
    this.containerId = containerId;
  }
  detach() {
    this.parent?.removeView(this);
  }
}

type ViewIndex = [number, number];

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
    // let foundSignal: Signal<ContainerView> | undefined;
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
  openContainerView(containerId: string) {
    const view = new ContainerView(containerId);
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
  addViewToRoot(view: ContainerView, ViewIndex = [0, 0]) {
    this.tree.addChild(view);
    this.setActivePaneId(view.id);
  }
  addHorizontally(containerId: string, ViewIndex = [0, 0]) {
    const view = new ContainerView(containerId);
    const [matrix] = this.matrix;
    matrix()[0].addView(view);
    this.setActivePaneId(view.id);
  }
  addVertically(containerId: string, ViewIndex = [0, 0]) {
    const view = new ContainerView(containerId);
    const [matrix, setMatrix] = this.matrix;
    const col = new Column();
    col.addView(view);
    setMatrix((prev) => [...prev, col]);
    this.setActivePaneId(view.id);
  }
  closeView(view: ContainerView) {
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
