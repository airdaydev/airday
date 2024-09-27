import { SunlistSession, SunlistWorkspace } from "../store/main";
import { ViewState } from "./state";

const keyName = (event: string, contextId: string) => `${event}:${contextId}`;

export function toggleSidebar(session: SunlistSession) {
  session.viewState.toggleSidebar();
}

export class KeyboardShortcuts {
  workspace: SunlistWorkspace;
  viewState: ViewState;
  handlerMap = new Map<string, (event: KeyboardEvent) => void>();
  globalHandlerActive = true;
  enabled: boolean = true; // for temporarily overriding for example when editing
  constructor(workspace: SunlistWorkspace, viewState: ViewState) {
    this.workspace = workspace;
    this.viewState = viewState;
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (!this.enabled) return;
      if (this.viewState.activeModal[0]()) {
        // Modal listener
        return;
      }
      if (this.viewState.activeRegion[0]() === "container") {
        this.workspace.dndContext.keyboard.listen(event);
      }
      if (this.viewState.activeRegion[0]() === "sidebar") {
        this.workspace.containerModel.dndContext.keyboard.listen(event);
      }
    });
  }
  globalKeyboardHandler(event: KeyboardEvent) {
    if (event.key === "s") {
      this.viewState.sidebarVisible[1]((prev) => !prev);
    }
    return false;
  }
  registerHandler(
    event: string,
    contextId: string,
    handler: (event: KeyboardEvent) => void,
  ) {
    this.handlerMap.set(keyName(event, contextId), handler);
  }
  unregisterHandler(event: string, contextId: string) {
    this.handlerMap.delete(keyName(event, contextId));
  }
  disable() {
    this.enabled = false;
  }
  enable() {
    this.enabled = true;
  }
}
