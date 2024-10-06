import { encodeShortcut } from "@sunlist/keyboard";
import { SunlistSession, SunlistWorkspace } from "../store/main";
import { ViewState } from "./state";
import { defaultMapping } from "./mapping";

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
  stopKeys = new Set<KeyboardEvent["key"]>();
  buffer: string[] = [];
  vimKeys = true;
  constructor(workspace: SunlistWorkspace, viewState: ViewState) {
    this.workspace = workspace;
    this.viewState = viewState;
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (!this.enabled) return;
      console.log(event.key);
      if (this.stopKeys.has(event.key)) {
        event.preventDefault();
        return;
      }
      if (this.viewState.activeRegion[0]() === "container") {
        let action = this.workspace.dndContext.keyboard.listen(event);
        if (action) return;
      }
      if (this.viewState.activeRegion[0]() === "sidebar") {
        let action =
          this.workspace.containerStore.dndContext.keyboard.listen(event);
        if (action) return;
      }
      const encodedEvent = encodeShortcut(event);
      if (this.viewState.activeModal[0]()) {
        // Modal listener
        return;
      }
      const func = defaultMapping.get(encodedEvent);
      if (func) {
        func({ workspace: this.workspace, viewState: this.viewState });
        this.clearBuffer();
      }
      const funcMulti = defaultMapping.get(this.buffer.join(","));
      if (funcMulti) {
        funcMulti({ workspace: this.workspace, viewState: this.viewState });
        this.clearBuffer();
      }
    });
  }
  addToBuffer(encodedKey: string) {
    if (this.buffer.length > 1) {
      this.buffer.shift();
    }
    this.buffer.push(encodedKey);
  }
  clearBuffer() {
    this.buffer = [];
  }
  disable() {
    this.enabled = false;
  }
  enable() {
    this.enabled = true;
  }
}
