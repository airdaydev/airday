import { encodeShortcut } from "@airday/keyboard";
import { AirSession, AirLibrary } from "../store/main";
import { ViewState } from "./state";
import { defaultMapping } from "./mapping";

export function toggleSidebar(session: AirSession) {
  session.viewState.toggleSidebar();
}

export class KeyboardShortcuts {
  library: AirLibrary;
  viewState: ViewState;
  handlerMap = new Map<string, (event: KeyboardEvent) => void>();
  globalHandlerActive = true;
  enabled: boolean = true; // for temporarily overriding for example when editing
  stopKeys = new Set<KeyboardEvent["key"]>();
  buffer: string[] = [];
  vimKeys = true;
  constructor(library: AirLibrary, viewState: ViewState) {
    this.library = library;
    this.viewState = viewState;
    window.addEventListener("keydown", (event: KeyboardEvent) => {
      if (!this.enabled) return;
      if (this.stopKeys.has(event.key)) {
        event.preventDefault();
        return;
      }
      if (this.viewState.activeRegion[0]() === "container") {
        let action = this.library.dndContext.keyboard.listen(event);
        if (action) return;
      }
      if (this.viewState.activeRegion[0]() === "sidebar") {
        let action =
          this.library.containerStore.dndContext.keyboard.listen(event);
        if (action) return;
      }
      const encodedEvent = encodeShortcut(event);
      if (this.viewState.activeModal[0]()) {
        // Modal listener
        return;
      }
      const func = defaultMapping.get(encodedEvent);
      if (func) {
        func({ library: this.library, viewState: this.viewState });
        this.clearBuffer();
      }
      const funcMulti = defaultMapping.get(this.buffer.join(","));
      if (funcMulti) {
        funcMulti({ library: this.library, viewState: this.viewState });
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
