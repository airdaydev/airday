import { createSignal, createUniqueId, Signal, createContext } from "solid-js";
import { GenericItem } from "../store/item";
import { AirLibrary } from "../store/main";
import { KeyboardShortcuts } from "./keyboard";
import { Workspace } from "./workspace";
import { ViewState } from "./state";

type ActiveRegionType = "sidebar" | "container";
type ModalTypes = "command" | "find" | null;
type ViewType = "container" | "data";
type DataViewType = "list" | "done" | "calendar";

export class ViewNode {
  id = createUniqueId();
  type: ViewType = "container";
  workspace: Workspace;
  viewState: ViewState;
  constructor(viewState: ViewState) {
    this.viewState = viewState;
    this.workspace = this.viewState.workspace;
  }
  detach() {
    this.workspace?.removeView(this);
  }
  get title(): string | false {
    return false;
  }
  loadWorkspaces() {
    // Load from local storage (workspaces = per device)
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
    const index = this.workspace.findNodeIndexById(this.id);
    this.workspace.replaceChild(view, index);
  };
  addLeft(view: ViewNode) {
    this.addSibling(view, "before");
  }
  addRight(view: ViewNode) {
    this.addSibling(view, "after");
  }
  addSibling(view: ViewNode, position: "before" | "after") {
    const ogParent = this.workspace;
    const thisIndex = ogParent.children[0]().indexOf(this);
    const newIndex = position === "before" ? thisIndex : thisIndex + 1;
    ogParent.addChild(view, newIndex);
  }
  // TODO: separate get next / get prev functions
  getSibling(direction: "left" | "right"): ViewNode | null {
    const index = this.workspace.findNodeIndexById(this.id);
    if (!index) return null;
    const siblings = this.workspace.children?.[0]() || [];

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
  // TODO: Broken logic
  get title(): false {
    const containerNode = this.viewState.library.containerStore.tree.idMap.get(
      this.containerId,
    );
    if (!containerNode) return false;
    return containerNode.name;
  }
  duplicate() {
    return new DataView(this.viewState, this.containerId);
  }
}
