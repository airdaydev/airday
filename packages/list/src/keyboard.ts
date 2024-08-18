import { DndContext } from "./dnd-context";

export class DndContextKeyboardEvents {
  enabled = false;
  vimKeys = true;
  dndContext: DndContext;
  constructor(dndContext: DndContext) {
    this.dndContext = dndContext;
    window.addEventListener("keydown", (event) => this.listen(event));
  }
  listen(event: KeyboardEvent) {
    const focused = this.dndContext.focusedContext();
    if (!focused) return;
    if (event.key === "ArrowUp" || event.key === "K") {
      if (event.metaKey) {
        // jump to & select top of list
      }
      if (event.shiftKey) {
        // Add to selection up
        // TODO: This requires looking from origin
        const prev = focused?.getPrevious();
        if (prev) focused?.addToSelection(prev);
        return;
      }
      if (event.altKey) {
        // Move item up
      }
      // Up movement from selection or bottom
      const prev = focused?.getPrevious();
      if (prev) focused?.selectOne(prev);
    }
    if (event.key === "ArrowDown" || event.key === "J") {
      if (event.metaKey) {
        // jump to & select bottom of list
      }
      if (event.shiftKey) {
        // Add to selection down
        const next = focused?.getNext();
        if (next) focused?.addToSelection(next);
        return;
      }
      if (event.altKey) {
        // Move item down
      }
      // Up movement from selection or top
      const next = focused?.getNext();
      if (next) focused?.selectOne(next);
    }
    if (event.key === "Escape") {
      // Clear selection
    }
    if (event.key === "gg") {
      // jump to & select top of list
    }
    if (event.key === "G") {
      // jump to & select bottom of list
    }
  }
}
