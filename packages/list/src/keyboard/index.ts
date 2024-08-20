import { encodeShortcut } from "./encoding";
import { DndContext } from "../dnd-context";
import { defaultMapping } from "./mapping";

export class DndContextKeyboardEvents {
  enabled = false;
  vimKeys = true;
  buffer = [];
  mode = null; // gg = sequence
  dndContext: DndContext;
  constructor(dndContext: DndContext) {
    this.dndContext = dndContext;
    window.addEventListener("keydown", (event) => this.listen(event));
  }
  enable() {
    // TODO: prevent multiple enables
    window.addEventListener("keydown", (event) => this.listen(event));
    this.enabled = true;
  }
  disable() {
    // TODO: Remove listener
    this.enabled = false;
  }
  listen = (event: KeyboardEvent) => {
    const ctx = this.dndContext.focusedContext();
    if (!ctx) return;
    const encoded = encodeShortcut(event);
    const func = defaultMapping.get(encoded);
    if (func) func(ctx);
  };
}
