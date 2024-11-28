import { TreeContext } from "../dnd-context";

/**
 * n.b. if there is no valid selection, will start from the end of the list
 */
export function selectRelativeToOrigin(direction: "above" | "below") {
  return (ctx: TreeContext) => {
    // Movement from selection
    if (ctx.selection[0]().size === 0 || !ctx.originNode) {
      const lastIndex = ctx.treeState.count();
      const item =
        direction === "above"
          ? ctx.treeState.childrenSignal[0]()[lastIndex - 1]
          : ctx.treeState.childrenSignal[0]()[0];
      ctx.selectOne(item);
      ctx.jumpScrollToIndex(direction === "above" ? lastIndex - 1 : 0);
      return;
    }
    const origin = ctx?.originNode;
    if (origin) {
      const d = ctx.getProjectionIndex(ctx.originNode);
      const next =
        direction === "above"
          ? ctx.projection()[d - 1]
          : ctx.projection()[d + 1];
      if (next) {
        ctx?.selectOne(next);
        ctx.jumpScrollToIndex(direction === "above" ? d - 1 : d + 1);
      }
    }
  };
}

export function selectOriginToTop(ctx: TreeContext) {
  if (!ctx.originNode) return; // TODO: Start from top?
  ctx.selectNodesInRange(0, ctx.originNode.getIndex());
  ctx.jumpScrollToIndex(0);
}
export function selectOriginToBottom(ctx: TreeContext) {
  if (!ctx.originNode) return; // TODO: Start from bottom?
  const end = ctx.presentCount() - 1;
  ctx.selectNodesInRange(ctx.originNode.getIndex(), end);
  ctx.jumpScrollToIndex(end);
}

// jump to & select top of list
export function jumpToTop(ctx: TreeContext) {
  ctx.selectOne(ctx.projection()[0]);
  ctx.jumpScrollToIndex(0);
}

export function selectAll(ctx: TreeContext) {
  ctx.selectAllNodes();
}

// jump to & select bottom of list
export function jumpToBottom(ctx: TreeContext) {
  const bottomIndex = ctx.projection().length - 1;
  const bottomNode = ctx.projection()[bottomIndex];
  ctx.selectOne(bottomNode);
  ctx.jumpScrollToIndex(bottomIndex);
}

// Selects or deselects depending on contiguous selected nodes from origin (shift + up/down)
export function selectFromOriginUp(ctx: TreeContext) {
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
    const node = ctx.projection()[prevIndex];
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

export function selectFromOriginDown(ctx: TreeContext) {
  // Shift down/up selects objects between most extreme node contiguous to origin
  if (!ctx.originNode) return; // TODO:
  // Remove from selection (selection extends above origin)
  const originIndex = ctx.originNode.getIndex();
  const prevDeselected = ctx.getNextDeselectedFromOrigin("prev");
  if (prevDeselected === originIndex - 1 || originIndex === 0) {
    // select down
    const nextIndex = ctx?.getNextDeselectedFromOrigin();
    const node = ctx.projection()[nextIndex];
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

export function clearSelection(ctx: TreeContext) {
  ctx.clearSelection();
}

export function moveSelectionUp(ctx: TreeContext) {
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
    ctx.treeState.insertItems(selection, [null, newPosition], true);
  }
}

export function moveSelectionDown(ctx: TreeContext) {
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
    ctx.treeState.insertItems(selection, [null, newPosition], true);
  }
}

export function expandNode(ctx: TreeContext) {
  // TODO: Base on selection?
  if (ctx.originNode) {
    ctx.originNode.expand();
    const children = ctx.treeState.childrenSignal[0]();
    ctx.treeState.childrenSignal[1]([...children]);
  }
}

export function collapseNode(ctx: TreeContext) {
  if (ctx.originNode) {
    ctx.originNode.collapse();
    const children = ctx.treeState.childrenSignal[0]();
    ctx.treeState.childrenSignal[1]([...children]);
  }
}
