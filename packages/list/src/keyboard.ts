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
    const ctx = this.dndContext.focusedContext();
    if (!ctx) return;
    if (event.key === "ArrowUp" || event.key === "K") {
      event.preventDefault();
      if (event.metaKey) {
        // jump to & select top of list
        ctx.selectOne(ctx.getNodeByIndex(0));
      }
      // selection.rangeOrigin && event.shiftKey
      if (event.shiftKey && ctx.originNode) {
        // Add to selection down
        const originIndex = ctx.originNode.getIndex();
        const nextDeselected = ctx.getNextDeselectedFromOrigin("next");
        if (
          nextDeselected === originIndex + 1 ||
          originIndex === ctx.treeState.count()
        ) {
          // select up
          const prevIndex = ctx?.getNextDeselectedFromOrigin("prev");
          const node = ctx.getNodeByIndex(prevIndex);
          if (prevIndex !== false) ctx?.toggleSelection(node);
          return;
        } else {
          // deselect up
          ctx.toggleSelection(
            ctx.treeState.childrenSignal[0]()[
              nextDeselected !== false
                ? nextDeselected - 1
                : ctx.treeState.count()
            ],
          );
          return;
        }
      }
      if (event.altKey) {
        // Move item up
      }
      // Down movement from selection or top
      const next = ctx?.getPrevious();
      if (next) ctx?.selectOne(next);
    }
    if (event.key === "ArrowDown" || event.key === "J") {
      if (event.metaKey) {
        // jump to & select bottom of list
        ctx.selectOne(ctx.getNodeByIndex(ctx.treeState.count()));
      }
      // Shift down/up selects objects between most extreme node contiguous to origin
      if (event.shiftKey && ctx.originNode) {
        // Remove from selection (selection extends above origin)
        const originIndex = ctx.originNode.getIndex();
        const prevDeselected = ctx.getNextDeselectedFromOrigin("prev");
        if (prevDeselected === originIndex - 1 || originIndex === 0) {
          // select down
          const nextIndex = ctx?.getNextDeselectedFromOrigin();
          const node = ctx.getNodeByIndex(nextIndex);
          if (nextIndex !== false) ctx?.toggleSelection(node);
          return;
        } else {
          // Deselect down
          ctx.toggleSelection(
            ctx.treeState.childrenSignal[0]()[
              prevDeselected !== false ? prevDeselected + 1 : 0
            ],
          );
          return;
        }
      }
      if (event.altKey) {
        // Move item down
      }
      // Up movement from selection or top
      const next = ctx?.getNext();
      if (next) ctx?.selectOne(next);
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
