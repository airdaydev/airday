import { ListDragContext } from "../dnd-context";

export function selectBelowOrigin(ctx: ListDragContext) {
  // Down movement from selection or top
  if (ctx.selection[0]().size === 0 || !ctx.originNode) {
    const firstIndex = 0;
    const firstItem = ctx.treeState.childrenSignal[0]()[firstIndex];
    ctx.selectOne(firstItem);
    ctx.jumpScrollToIndex(firstIndex);
    return;
  }
  const origin = ctx?.originNode;
  if (origin) {
    const sibling = ctx.getSibling(origin, "next");
    ctx?.selectOne(sibling[1]);
    ctx.jumpScrollToIndex(sibling[0]);
  }
}

/**
 * n.b. if there is no valid selection, will start from the end of the list
 */
export function selectAboveOrigin(ctx: ListDragContext) {
  // Up movement from selectionA
  if (ctx.selection[0]().size === 0 || !ctx.originNode) {
    const lastIndex = ctx.treeState.count();
    const lastItem = ctx.treeState.childrenSignal[0]()[lastIndex - 1];
    ctx.selectOne(lastItem);
    ctx.jumpScrollToIndex(lastIndex - 1);
    return;
  }
  const origin = ctx?.originNode;
  if (origin) {
    const sibling = ctx.getSibling(origin, "prev");
    ctx?.selectOne(sibling[1]);
    ctx.jumpScrollToIndex(sibling[0]);
  }
}

export function selectOriginToTop(ctx: ListDragContext) {
  if (!ctx.originNode) return; // TODO: Start from top?
  ctx.selectNodesInRange(0, ctx.originNode.getIndex());
  ctx.jumpScrollToIndex(0);
}
export function selectOriginToBottom(ctx: ListDragContext) {
  if (!ctx.originNode) return; // TODO: Start from bottom?
  const end = ctx.presentCount() - 1;
  ctx.selectNodesInRange(ctx.originNode.getIndex(), end);
  ctx.jumpScrollToIndex(end);
}

// jump to & select top of list
export function jumpToTop(ctx: ListDragContext) {
  ctx.selectOne(ctx.getNodeByIndex(0));
  ctx.jumpScrollToIndex(0);
}

export function selectAll(ctx: ListDragContext) {
  ctx.selectAllNodes();
}

// jump to & select bottom of list
export function jumpToBottom(ctx: ListDragContext) {
  const bottomIndex = ctx.treeState.count() - 1;
  const bottomNode = ctx.getNodeByIndex(bottomIndex);
  ctx.selectOne(bottomNode);
  ctx.jumpScrollToIndex(bottomIndex);
}

// Selects or deselects depending on contiguous selected nodes from origin (shift + up/down)
export function selectFromOriginUp(ctx: ListDragContext) {
  if (!ctx.originNode) return; // TODO: Start from top?
  // Add to selection down
  const originIndex = ctx.originNode.getIndex();
  const nextDeselected = ctx.getNextDeselectedFromOrigin("next");
  if (
    nextDeselected === originIndex + 1 ||
    originIndex === ctx.treeState.count() - 1
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
          : ctx.treeState.count() - 1
      ],
    );
    return;
  }
}

export function selectFromOriginDown(ctx: ListDragContext) {
  // Shift down/up selects objects between most extreme node contiguous to origin
  if (!ctx.originNode) return; // TODO:
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

export function clearSelection(ctx: ListDragContext) {
  ctx.clearSelection();
}

export function moveSelectionUp(ctx: ListDragContext) {
  if (!ctx.allowMovement) return;
  const selection = ctx.selection[0]();
  if (selection.size === 0) return;
  let newPosition = null;
  if (selection.size === 1) {
    const only = selection.values().next().value;
    newPosition = Math.max(0, only.getIndex() - 1);
  } else {
    newPosition = ctx.getFirstIndexSelected();
    if (typeof newPosition === "number") {
      newPosition = Math.max(0, (newPosition -= 1));
    }
  }
  if (newPosition !== null) {
    ctx.treeState.moveItems(selection, null, newPosition);
  }
}

export function moveSelectionDown(ctx: ListDragContext) {
  if (!ctx.allowMovement) return;
  const selection = ctx.selection[0]();
  if (selection.size === 0) return;
  let newPosition = null;
  if (selection.size === 1) {
    const only = selection.values().next().value;
    newPosition = only.getIndex() + 1;
  } else {
    newPosition = ctx.getFirstIndexSelected();
    if (typeof newPosition === "number") newPosition += 1;
  }
  if (newPosition !== null && newPosition < ctx.treeState.count()) {
    ctx.treeState.moveItems(selection, null, newPosition);
  }
}
