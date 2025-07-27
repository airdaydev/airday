import { createSignal, Signal, createContext } from "solid-js";
import { GenericItem } from "../store/item";
import { AirLibrary } from "../store/main";
import { KeyboardShortcuts } from "./keyboard";
import { Workspace } from "./workspace";
import {
  CalendarView,
  DataView,
  DoneView,
  UpNextView,
  ViewNode,
} from "./views";

type ActiveRegionType = "sidebar" | "container";
type ModalTypes = "command" | "find" | null;

type Scene = "default" | "focus";

/**
 * Views
 * pane 0 = sidebar
 * pane 1...9+ = lists
 * default = 1 pane: inbox
 * ⌘+/ = command modal
 * / = find modal
 * State should be saved in local storage, per library
 */
export class ViewState {
  activeModal: Signal<ModalTypes> = createSignal<ModalTypes>(null);
  activeRegion: Signal<ActiveRegionType> =
    createSignal<ActiveRegionType>("container");
  activePane = createSignal<ViewNode | undefined>();
  sidebarVisible = createSignal<boolean>(true);
  // workspace = new Workspace();
  workspaces = createSignal<Workspace[]>([new Workspace()]);
  activeWorkspace = createSignal<number>(0);
  scene = createSignal<Scene>("default");
  focus?: GenericItem;
  library: AirLibrary;
  keyboard: KeyboardShortcuts;
  paneDropView?: ViewNode; // This is the currently selected pane being dragged
  constructor(library: AirLibrary) {
    this.library = library;
    this.keyboard = new KeyboardShortcuts(library, this);
  }
  get workspace() {
    return this.workspaces[0]()[0];
  }
  loadWorkspaces() {
    // Load from local storage (workspaces = per device)
  }
  switchWorkspace(index = 0) {
    this.activeWorkspace[1](index);
  }
  count() {
    return this.workspace.count();
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
    const dnd = this.library.containerStore.getNavDnd();
    if (dnd) dnd.clearSelection();
  }
  openFocusScene() {
    this.scene[1]("focus");
  }
  openDefaultScene() {
    this.scene[1]("default");
    const t = this.library.dndContext.focusedContext();
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
    const relativeNode = this.workspace.findNodeById(relativeTo);
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
    this.workspace.addChild(view);
  }
  closeView(view: DataView) {
    view.detach();
  }
}

export const viewContext = createContext<ViewState>();
