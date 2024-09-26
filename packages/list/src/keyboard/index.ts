import { encodeShortcut } from "@sunlist/keyboard";
import { DndContext } from "../dnd-context";
import { defaultMapping, vimMapping } from "./mapping";

export class DndContextKeyboardEvents {
  enabled = false;
  vimKeys = true;
  buffer: string[] = [];
  mode = null; // gg = sequence
  dndContext: DndContext;
  private boundListen: (event: KeyboardEvent) => void;

  constructor(dndContext: DndContext, enabled: boolean = true) {
    this.dndContext = dndContext;
    this.enabled = enabled;
    this.boundListen = this.listen.bind(this);
    if (this.enabled) {
      this.enable();
    }
  }

  enable() {
    if (!this.enabled) {
      this.enabled = true;
      window.addEventListener("keydown", this.boundListen);
    }
  }

  disable() {
    if (this.enabled) {
      this.enabled = false;
      window.removeEventListener("keydown", this.boundListen);
    }
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
  listen = (event: KeyboardEvent) => {
    const ctx = this.dndContext.focusedContext();
    if (!ctx) return;
    const encodedEvent = encodeShortcut(event);
    const func = defaultMapping.get(encodedEvent);
    if (func) {
      this.clearBuffer();
      event.preventDefault();
      return func(ctx);
    }
    if (this.vimKeys) {
      const vimFunc = vimMapping.get(encodedEvent);
      if (vimFunc) {
        event.preventDefault();
        this.clearBuffer();
        return vimFunc(ctx);
      }
    }
    // TODO: Support key sequences for non-vim?
    this.addToBuffer(encodedEvent);
    const funct = vimMapping.get(this.buffer.join(","));
    if (funct) funct(ctx);
  };
}
