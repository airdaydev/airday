import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
} from "solid-js";
import { Node, TreeState } from "./state";
import { walk } from "./tree-utils";
import { ContainerVector } from "./tree";
import { DndContextKeyboardEvents } from "./keyboard/index";

export type VirtualisedList = Accessor<{
  window: Node[];
  start: number;
}>;

// Per list dnd context
export class ListDragContext {
  id = createUniqueId();
  treeState: TreeState;
  selection = createSignal(new Set<Node>());
  originIndex: number | null = 0; // TODO: This could move if other items are inserted...
  isOrigin = false; // true = this is the list where the user has dragged from
  lastTouchedIndexSignal = createSignal<number | undefined>();
  dndContext: DndContext;
  originNode: Node | null = null; // prev, dragOriginNode The actual node that the user clicked on
  dragOriginNodeIndex: number | undefined; // TODO: Use & memoised w respect to treestate
  itemHeight: number;
  scrollContainerRef?: HTMLElement;
  placeholderStyle?: string;
  allowInternalMovement = true;
  projection: Accessor<Node[]>;
  constructor(opts: {
    treeState: TreeState;
    dndContext: DndContext;
    itemHeight: number;
    placeholderStyle?: string;
    allowInternalMovement?: boolean;
  }) {
    this.treeState = opts.treeState;
    this.dndContext = opts.dndContext;
    opts.dndContext.listContexts.add(this);
    this.itemHeight = opts.itemHeight;
    this.placeholderStyle = opts.placeholderStyle;
    this.allowInternalMovement = opts.allowInternalMovement ?? true;
    this.projection = this.createProjectionMemo();
  }
  get allowMovement() {
    return this.dndContext.enableDrop && this.allowInternalMovement;
  }
  isFocused() {
    return this.dndContext.focusContext[0]() === this;
  }
  setFocus() {
    this.dndContext.focusContext[1](() => this);
  }
  isDraggingOver() {
    return this.dndContext.dragContext[0]() === this;
  }
  setDragOver() {
    this.dndContext.dragContext[1](() => this);
  }
  clearSelection() {
    this.selection[1](new Set([]));
  }
  isSelected(node: Node) {
    const selection = this.selection[0]();
    return selection.has(node);
  }
  // TODO: Experiment with fast smooth scroll
  jumpScrollToIndex(index: number) {
    if (!this.scrollContainerRef) return; // should never happen
    const itemOffset = index * this.itemHeight;
    const scrollBounds = this.scrollContainerRef.getBoundingClientRect();
    if (itemOffset < this.scrollContainerRef.scrollTop) {
      this.scrollContainerRef.scrollTo(0, itemOffset);
    }
    if (itemOffset > this.scrollContainerRef.scrollTop + scrollBounds.height) {
      this.scrollContainerRef.scrollTo(
        0,
        itemOffset + this.itemHeight - scrollBounds.height,
      );
    }
  }
  leave() {
    if (this.dndContext.isDragging()) this.dndContext.dragContext[1](null);
    if (this.isOrigin) {
      return;
    } // Keeps origin in place for origin list
    this.reset();
  }
  startDrag(
    originIndex: number,
    originNode: Node,
    ref: HTMLElement,
    elClickOffset: [number, number] = [0, 0],
  ) {
    this.isOrigin = true;
    this.originIndex = originIndex;
    this.originNode = originNode;
    this.dndContext.startDrag(ref, elClickOffset);
    this.setDragOver();
  }
  stopDrag() {
    this.reset();
    this.dndContext.stopDrag();
  }
  reset() {
    this.isOrigin = false;
    this.originIndex = null;
    this.originNode = null;
    this.setLastTouchedIndex(undefined); // TODO: a little bit smelly
  }
  selectOne(node: Node) {
    if (!node) return;
    const selection = new Set([node]);
    this.originNode = node;
    this.selection[1](selection);
  }
  toggleSelection(node: Node, setOrigin: boolean = false) {
    const selection = new Set(this.selection[0]());
    if (selection.has(node)) {
      selection.delete(node);
      this.selection[1](selection);
      const first = this.getFirstIndexSelected();
      if (setOrigin && first) {
        this.originNode = this.treeState.childrenSignal[0]()[first];
      }
    } else {
      selection.add(node);
      this.selection[1](selection);
      if (setOrigin) this.originNode = node;
    }
  }
  getFirstIndexSelected() {
    // TODO: We could collect all sortkeys through an up-to-date hashmap
    const projection = this.projection();
    for (let i = 0; i < projection.length; i++) {
      if (this.selection[0]().has(projection[i])) return i;
    }
    return false;
  }
  getFirstSelected() {
    const projection = this.projection();
    for (let i = 0; i < projection.length; i++) {
      if (this.selection[0]().has(projection[i])) return projection[i];
    }
    return false;
  }

  getLastIndexSelected() {
    // TODO: We could collect all sortkeys through an up-to-date hashmap
    const projection = this.projection();
    for (let i = projection.length - 1; i >= 0; i--) {
      if (this.selection[0]().has(projection[i])) return i;
    }
    return false;
  }
  getSibling(node: Node, direction: "next" | "prev"): [number, Node] {
    const index = node.getIndex();
    const projection = this.projection();
    const lastIndex = projection.length - 1;
    if (index === lastIndex && direction === "next") {
      return [index, node];
    }

    if (index === 0 && direction === "prev") {
      return [index, node];
    }

    const siblingIndex = direction === "next" ? index + 1 : index - 1;
    return [siblingIndex, projection[siblingIndex]];
  }
  getPreviousSelected(): [number, Node] {
    const first = this.getFirstIndexSelected();
    if (!first) {
      return [0, this.projection()[0]];
    }
    const index = first - 1;
    return [index, this.projection()[index]];
  }
  getNextSelected(): [number, Node] {
    const last = this.getLastIndexSelected();
    if (last === false) {
      const index = this.projection().length - 1;
      return [index, this.projection()[index]];
    }
    const index = last + 1;
    return [index, this.projection()[index]];
  }

  getNextDeselectedFromOrigin(direction: "next" | "prev" = "next") {
    const list = this.treeState.childrenSignal[0]();
    let rangeEnded = false;
    let i = this.originNode?.getIndex();
    if (i === false) return false;
    while (!rangeEnded) {
      const next = list[i];
      if (!next) return false;
      if (this.selection[0]().has(next)) {
        direction === "next" ? i++ : i--;
      } else {
        return i;
      }
    }
    return false;
  }
  selectNodesInRange(start: number, end: number) {
    const newSelection = this.projection().slice(start, end + 1);
    const selection = new Set(newSelection);
    this.selection[1](selection);
  }
  selectAllNodes() {
    const newSelection = this.projection().slice(0, this.presentCount() + 1);
    const selection = new Set(newSelection);
    this.selection[1](selection);
  }
  setLastTouchedIndex(index: number) {
    if (!this.allowMovement) return;
    return this.lastTouchedIndexSignal[1](index);
  }
  createProjectionMemo() {
    return createMemo(() => {
      const visibleChildren: Node[] = [];
      let n = new Node();
      n.isRoot = true;
      n.children = this.treeState.childrenSignal[0]();
      let index = 0;
      const isDragging = this.dndContext.isDragging();
      // Flattens the tree
      walk<Node, Node>(n, (node) => {
        // Keeping the node that user actually dragged in place
        const dragOriginNode = node === this.originNode;
        if (dragOriginNode) {
          this.originIndex = index;
          index++;
        }
        // Skip root & other selected items
        const skip =
          node.isRoot ||
          (isDragging &&
            this.selection[0]().has(node) &&
            !dragOriginNode &&
            this.isOrigin);
        if (!skip) {
          index++;
          visibleChildren.push(node);
        }
        if (
          node.expanded &&
          isDragging &&
          this.selection[0]().has(node) &&
          this.isOrigin
        ) {
          // Skipping the selected items children when dragging
          return true;
        }
        if (!node.expanded) {
          return true;
        }
      });
      return visibleChildren;
    });
  }
  getProjectionIndex(node: Node) {
    // TODO: Memoise projection!
    const t = this.projection().findIndex((n) => n === node);
    return t;
  }
  // Projection of list i.e. visible children, often filtered by dragged items
  getWindowedSignal(
    containerVector: Accessor<ContainerVector>,
  ): VirtualisedList {
    // Virtualisation
    return createMemo(() => {
      const rowHeight = this.itemHeight;
      const [containerHeight, offset] = containerVector();
      const buffer = 20; // TODO: Buffer should be linked to scroll change required to update
      const excess = offset % rowHeight;
      const start =
        Math.max(0, offset - excess - buffer * rowHeight) / rowHeight;
      const renderCount = Math.floor(containerHeight / rowHeight) + buffer * 2;
      let window = this.projection().slice(start, start + renderCount);
      return {
        window,
        start,
      };
    });
  }
  /**
   * This count includes total item count minus the selected items (excluding origin) when dragging
   * or total count generally
   */
  presentCount = () => {
    if (this.dndContext.isDragging() && this.isOrigin) {
      return this.treeState.count(true) - this.selection[0]().size + 1;
    } else {
      return this.treeState.count(true);
    }
  };
  dropItems = (originList: ListDragContext) => {
    if (!this.allowMovement) return;
    const lastTouchedNode =
      this.projection()[this.lastTouchedIndexSignal[0]() || 0];
    // TODO: if parent, index needs to be local index
    const parent = lastTouchedNode.parent?.isRoot
      ? null
      : lastTouchedNode.parent;
    this.treeState.context?.moveItems(
      originList.selection[0](),
      originList.treeState,
      this.treeState,
      [parent, this.lastTouchedIndexSignal[0]()],
    );
    this.setFocus();
    this.selection[1](originList.selection[0]());
    if (originList !== this) {
      originList.clearSelection();
    }
  };
}

type dragMode = "touch" | "mouse" | null;

interface DndContextInitArgs {
  enableKeyboard: boolean;
}

// There is only one drag context, but there can be multiple select contexts
// This mostly controls the dragged item
export class DndContext {
  dragMode = createSignal<dragMode>();
  focusContext = createSignal<ListDragContext | null>(null);
  dragContext = createSignal<ListDragContext | null>(null);
  listContexts = new Set<ListDragContext>();
  draggedEl: HTMLElement | null = null; // Clone of element that was dragged
  elClickOffset = [0, 0];
  elDimensionsPx: [number, number] = [200, 32];
  dragMove = createSignal<[number, number]>([-100, -100]); // TODO: Don't render instead of storing off screen
  keyboard: DndContextKeyboardEvents;
  enableDrop = true;
  constructor(props: DndContextInitArgs = { enableKeyboard: true }) {
    this.keyboard = new DndContextKeyboardEvents(this, props.enableKeyboard);
  }
  startDrag(
    ref: HTMLElement,
    elClickOffset: [number, number] = [0, 0],
    dragMode: dragMode = "mouse",
  ) {
    // Set up dragged element
    this.elClickOffset = elClickOffset;
    const bounds = ref.getBoundingClientRect();
    this.elDimensionsPx = [bounds.width, bounds.height];
    this.draggedEl = ref.cloneNode(true);
    this.dragMode[1](dragMode);
  }
  focusedContext() {
    return this.focusContext[0]();
  }
  // For touch
  checkLeave(el: Element) {
    this.listContexts.forEach((ctx) => {
      if (ctx.isDraggingOver()) {
        const contains = ctx.scrollContainerRef?.contains(el);
        if (!contains) {
          ctx.leave();
        }
      }
    });
  }
  isDragging = () => !!this.dragMode[0]();
  /** mouse or touch coords */
  moveDragCoords(x: number, y: number) {
    this.dragMove[1]([x, y]);
  }
  onDragMove(callback: (coords: [number, number]) => void) {
    return createEffect(() => {
      callback(this.dragMove[0]());
    });
  }
  stopDrag() {
    this.elClickOffset = [0, 0];
    this.draggedEl = null;
    this.dragMode[1](null);
    this.dragContext[1](null);
  }
}

export const SolidListContext = createContext<ListDragContext | null>(null);
