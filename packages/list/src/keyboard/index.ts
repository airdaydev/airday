import { encodeShortcut } from "./encoding";
import { DndContext } from "../dnd-context";
import { defaultMapping, vimMapping } from "./mapping";

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
    console.log(event.key);
    const ctx = this.dndContext.focusedContext();
    if (!ctx) return;
    const encoded = encodeShortcut(event);
    const func = defaultMapping.get(encoded);
    if (func) {
      event.preventDefault();
      return func(ctx);
    }
    if (this.vimKeys) {
      const vimFunc = vimMapping.get(encoded);
      if (vimFunc) {
        event.preventDefault();
        return vimFunc(ctx);
      }
    }
    console.log("no keyboard shortcut found");
  };
}
