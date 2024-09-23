import {
  createSignal,
  createUniqueId,
  Signal,
  Accessor,
  Setter,
  createContext,
} from "solid-js";
import { GenericItem } from "../store/loader";

type ActiveRegionTypes = "sidebar" | "container";
type ModalTypes = "command" | "find" | undefined;

class ContainerView implements BordeContainerView {
  id = createUniqueId();
  containerId: string;
  type: "container" = "container";
  projection: "list" | "kanban" = "list";
  parent?: Column;
  constructor(containerId: string) {
    this.containerId = containerId;
  }
}

class Column {
  id = createUniqueId();
  type = "column";
  views: Signal<ContainerView[]> = createSignal(new Array());
  addView = (view: ContainerView, index?: number) => {
    view.parent = this;
    this.views[1]((prev) => [...prev, view]);
  };
  replaceRow = (view: ContainerView, index: number = 0) => {
    this.views[1]((prev) => {
      const next = [...prev];
      next[index] = view;
      return next;
    });
  };
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
  matrix = createSignal<Column[]>([new Column()]); // views 2D matrix
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
    this.replaceActiveView(view);
  }
  openDoneView = () => {
    // const id = createUniqueId();
    // const view: BordeDoneView = {
    //   id,
    //   type: "done",
    // };
    // this.replaceActiveView(view);
  };
  replaceActiveView(view: ContainerView) {
    this.replaceView(view, 0);
  }
  replaceView(view: ContainerView, ViewIndex = [0, 0]) {
    const [matrix] = this.matrix;
    matrix()[0].replaceRow(view);
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
  closeView(index: number) {
    const [matrix, setMatrix] = this.matrix;
    // const col = matrix[0]();
    // const view = matrix()[index][0]().id;
    // if (!view) return;
    // return setMatrix((prev) => {
    //   prev.splice(index, 1);
    //   return [...prev];
    // });
  }
  addContainerView = (containerId: string, rowNumber: number = 0) => {
    // TODO: Allow more lists
    if (this.matrix[0]().length > 4) return;
    const id = createUniqueId();
    const view = createSignal<ContainerView>({
      // TODO: Detect clash / or how does this lib work
      id,
      type: "container",
      containerId,
      projection: "list",
    });
    this.setActivePaneId(id);
    const [list, setList] = this.matrix;
    return setList((prev) => {
      return [...prev, view];
    });
  };
}

export const viewState = new ViewState();
export const viewContext = createContext<ViewState>(viewState);
