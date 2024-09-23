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
  matrix = createSignal<Signal<BordeView[][]>>([[]]); // views 2D matrix
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
    let foundSignal: Signal<BordeView> | undefined;
    let foundRow = -1;
    let foundCol = -1;

    this.matrix[0]().some((row, rowIndex) => {
      const colIndex = row.findIndex(
        (view) => view[0]().id === this.activePaneId(),
      );
      if (colIndex !== -1) {
        foundSignal = row[colIndex];
        foundRow = rowIndex;
        foundCol = colIndex;
        return true;
      }
      return false;
    });

    return {
      signal: foundSignal,
      row: foundRow,
      col: foundCol,
    };
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
    const view = this.createContainerView(containerId);
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
  createContainerView(containerId: string): BordeView {
    const id = createUniqueId(); // TODO: How does uniqueness work here
    return {
      id,
      type: "container",
      containerId,
      projection: "list",
    };
  }
  replaceActiveView(view: BordeView) {
    this.replaceView(view, 0);
  }
  replaceView(view: BordeView, index: number = 0) {
    const newView = createSignal<BordeView>(view);
    const [matrix, setMatrix] = this.matrix;
    setMatrix((prev) => {
      const newMatrix = prev.map((row) => [...row]);
      newMatrix[0][index] = newView;
      console.log("setting new matrix", newMatrix);
      return newMatrix;
    });
    this.setActivePaneId(view.id);
  }
  closeView(index: number) {
    // TODO: if active view, remove active view (does it matter?)
    const [list, setList] = this.matrix;
    const view = list()[index][0]().id;
    if (!view) return;
    return setList((prev) => {
      prev.splice(index, 1);
      return [...prev];
    });
  }
  addContainerView = (containerId: string, rowNumber: number = 0) => {
    // TODO: Allow more lists
    if (this.matrix[0]().length > 4) return;
    const id = createUniqueId();
    const view = createSignal<BordeView>({
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
