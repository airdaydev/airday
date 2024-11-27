import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
} from "solid-js";
import { Node, RootNode, TreeState } from "./state";
import { walk } from "./tree-utils";
import { DndContextKeyboardEvents } from "./keyboard/index";
import { TreeCanvas } from "./canvas";
import { Coordinates } from "./utils";

export type ContainerVector = [scrollHeight: number, scrollOffset: number];

export type VirtualisedList = Accessor<{
  window: Node[];
  start: number;
}>;

// Per list dnd context
export class TreeContext {
  id = createUniqueId();
  treeState: TreeState;
  selection = createSignal(new Set<Node>());
  projection: Accessor<Node[]>; // Current state
  // User Options
  itemHeight: number;
  allowInternalMovement = true;
  placeholderStyle?: string; // TODO: Deprecate for canvas version
  // Drag
  dndContext: DndContext;
  isDragOrigin = false; // TODO: Should this be derived this from dndContext?
  originIndex: number | null = 0; // TODO: This could move if other items are inserted...
  originNode: Node | null = null;
  originRef?: HTMLElement;
  mouseDownCoords?: Coordinates;
  mouseDownOffset?: Coordinates;
  rowDraggedOver = createSignal<number | null>(null); // TODO: Do we need a signal?
  // DOM & Render
  canvas?: TreeCanvas;
  listRef?: HTMLElement;
  scrollContainerRef?: HTMLElement; // TODO: Integrate into v3 properly
  height = createSignal(500);
  scrollOffset = createSignal(0);
  listBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  noAnimation = createSignal<boolean>(false);
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
  get containerVector() {
    return createMemo<ContainerVector>(() => {
      return [this.height[0](), this.scrollOffset[0]()];
    });
  }
  recalcListBounds() {
    if (this.listRef) {
      const bounds = this.listRef.getBoundingClientRect();
      this.listBounds = {
        minX: window.scrollX + bounds.x,
        maxX: window.scrollX + bounds.x + bounds.width,
        minY: window.scrollY + bounds.y,
        maxY: window.scrollY + bounds.y + bounds.height,
      };
    }
  }
  mount(opts: { canvasRef: HTMLCanvasElement; listRef: HTMLElement }) {
    this.listRef = opts.listRef;
    this.recalcListBounds();
    this.canvas = new TreeCanvas({
      treeContext: this,
      canvasRef: opts.canvasRef,
    });
    this.listRef.addEventListener("scroll", () => this.setListOffset());
  }
  setListOffset() {
    this.scrollOffset[1](this.listRef.scrollTop);
  }
  unmount() {
    this.listRef = undefined;
    this.canvas = undefined;
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
    // Are we dragging over this particular list?
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
    if (this.isDragOrigin) {
      return;
    } // Keeps origin in place for origin list
    this.reset();
  }
  // This controls
  // TODO: Possibly doubling up with dragged.tsx
  mousePosFrame = (event: MouseEvent) => {
    if (
      window.scrollX + event.x < this.listBounds.minX ||
      window.scrollX + event.x > this.listBounds.maxX
    ) {
      this.rowDraggedOver[1](undefined);
      return; // out of x bounds
    }
    const mousePosListY = window.scrollY + event.y - this.listBounds.minY;
    const row = Math.floor(mousePosListY / this.itemHeight);
    if (row !== this.rowDraggedOver[0]()) {
      this.rowDraggedOver[1](row);
    }
  };
  dragMouseMove = (event: MouseEvent) => {
    this.mousePosFrame(event);
  };
  startDrag(
    originIndex: number,
    originNode: Node,
    ref: HTMLElement,
    elClickOffset: Coordinates = [0, 0],
  ) {
    this.isDragOrigin = true;
    this.originIndex = originIndex;
    this.originNode = originNode;
    this.dndContext.startDrag(ref, elClickOffset);
    this.recalcListBounds();
    this.setDragOver();
    window.addEventListener("mousemove", this.dragMouseMove);
  }
  stopDrag() {
    window.removeEventListener("mousemove", this.dragMouseMove);
    this.reset();
    this.dndContext.stopDrag();
    this.rowDraggedOver[1](undefined);
  }
  reset() {
    this.isDragOrigin = false;
    this.originIndex = null;
    this.originNode = null;
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
  createProjectionMemo() {
    return createMemo(() => {
      const visibleChildren: Node[] = [];
      let n = new RootNode();
      n.isRoot = true;
      n.children = this.treeState.childrenSignal[0]();
      let index = 0;
      const isDragging = this.dndContext.isDragging();
      // Flattens the tree
      walk<Node, Node>(n, (node) => {
        // Skip root & other selected items
        const skip =
          node.isRoot ||
          (isDragging && this.selection[0]().has(node) && this.isDragOrigin);
        if (!skip) {
          index++;
          visibleChildren.push(node);
        }
        if (
          node.expanded &&
          isDragging &&
          this.selection[0]().has(node) &&
          this.isDragOrigin
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
  getItemPosition(list: VirtualisedList, index: Accessor<number>) {
    // Takes into account current drag over position!
    // list().start
    let offset = 0;
    if (
      this.isDraggingOver() &&
      typeof this.rowDraggedOver[0]() === "number" &&
      index() >= this.rowDraggedOver[0]()
    ) {
      offset = this.itemHeight;
    }
    return index() * this.itemHeight + offset;
  }
  // Projection of list i.e. visible children, often filtered by dragged items
  getWindowedSignal(): VirtualisedList {
    // Virtualisation
    return createMemo(() => {
      const rowHeight = this.itemHeight;
      const [containerHeight, offset] = this.containerVector();
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
    if (this.dndContext.isDragging() && this.isDragOrigin) {
      return this.projection().length - this.selection[0]().size + 1;
    } else {
      return this.projection().length;
    }
  };
  dropItems = (originList: TreeContext) => {
    if (!this.allowMovement) return;
    const dropIndex = this.rowDraggedOver[0]();
    if (typeof dropIndex !== "number") return;
    // Hack but it's ok for now, stops an awkward drop animation for items below drop area
    this.noAnimation[1](true);
    setTimeout(() => this.noAnimation[1](false), 10);
    const lastTouchedNode = this.projection()[dropIndex];
    // TODO: if parent, calc local index:
    // TODO: Depth needs to be updated
    let parent = null;
    if (
      lastTouchedNode &&
      lastTouchedNode.parent &&
      !lastTouchedNode.parent.isRoot
    ) {
      parent = lastTouchedNode.parent;
    }
    const items = originList.treeState.take(originList.selection[0]());
    this.treeState.insertItems(items, [
      parent,
      parent === null ? dropIndex : lastTouchedNode.localIndex || 0,
    ]);
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
  focusContext = createSignal<TreeContext | null>(null);
  dragContext = createSignal<TreeContext | null>(null);
  listContexts = new Set<TreeContext>();
  draggedEl: HTMLElement | null = null; // Clone of element that was dragged
  elClickOffset = [0, 0];
  elDimensionsPx: Coordinates = [200, 32];
  dragMove = createSignal<Coordinates>([-100, -100]); // TODO: Don't render instead of storing off screen
  keyboard: DndContextKeyboardEvents;
  enableDrop = true;
  constructor(props: DndContextInitArgs = { enableKeyboard: true }) {
    this.keyboard = new DndContextKeyboardEvents(this, props.enableKeyboard);
  }
  startDrag(
    ref: HTMLElement,
    elClickOffset: Coordinates = [0, 0],
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
  onDragMove(callback: (coords: Coordinates) => void) {
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

export const SolidListContext = createContext<TreeContext | null>(null);
