import {
  Accessor,
  createEffect,
  createMemo, createSignal, createUniqueId,
  on,
} from 'solid-js';
import { Node, TreeState } from './state';
import { walk } from './tree-utils';
import { ContainerVector } from './tree';

export type VirtualisedList = Accessor<{
  window: Node[];
  start: number;
}>;

// Per list dnd context
export class ListDragContext {
  id = createUniqueId();
  treeState: TreeState;
  selection = createSignal(new Set<Node>);
  originIndex: number | null = 0; // TODO: This could move if other items are inserted...
  isOrigin = false; // true = this is the list where the user has dragged from
  dragOver = createSignal(false); // Is the user currently dragging over this list
  lastTouchedIndexSignal = createSignal<number | undefined>();
  projection: Accessor<Node[]>;
  dndContext: DndContext;
  originNode: Node | null = null; // prev, dragOriginNode The actual node that the user clicked on
  dragOriginNodeIndex: number | undefined;
  itemHeight: number;
  scrollContainerRef?: HTMLElement;
  constructor(treeState: TreeState, dndContext: DndContext, itemHeight: number) {
    this.treeState = treeState;
    this.dndContext = dndContext;
    dndContext.listContexts.add(this);
    this.projection = this.initProjection();
    this.itemHeight = itemHeight;
  }
  isSelected(node: Node) {
    return createMemo(() => {
      const selection = this.selection[0]();
      return selection.has(node);
    })
  }
  leave() {
    if (this.dndContext.isDragging) this.dragOver[1](false)
    if (this.isOrigin) { return; } // Keeps origin in place for origin list
    this.reset();
  }
  startDrag(originIndex: number, originNode: Node, ref: HTMLElement, elClickOffset: [number, number] = [0, 0]) {
    this.isOrigin = true;
    this.originIndex = originIndex;
    this.originNode = originNode;
    this.dndContext.startDrag(ref, elClickOffset);
  }
  stopDrag() {
    this.reset();
    this.dndContext.stopDrag();
  }
  reset() {
    this.isOrigin = false;
    this.originIndex = null;
    this.originNode = null;
    this.setLastTouchedIndex(0); // TODO: think about carefully, causes slight bug
  }
  selectOne(node: Node) {
    const selection = new Set([node]);
    this.selection[1](selection);
  }
  addToSelection(node: Node) {
    const selection = new Set(this.selection[0]())
    if (selection.has(node)) {
      selection.delete(node);
    } else {
      selection.add(node);
    }
    this.selection[1](selection);
  }
  getFirstIndexSelected() {
    // TODO: We could collect all sortkeys through an up-to-date hashmap
    const projection = this.projection();
    for (let i = 0; i < projection.length; i++) {
        if (this.selection[0]().has(projection[i])) return i;
    }
    return false;
  }
  getLastIndexSelected() {
    // TODO: We could collect all sortkeys through an up-to-date hashmap
    const projection = this.projection();
    for (let i = projection.length - 1; i >= 0 ; i--) {
        if (this.selection[0]().has(projection[i])) return i;
    }
    return false;
  }
  selectNodesInRange(start: number, end: number) {
    const newSelection = this.projection().slice(start, end + 1);
    const selection = new Set(newSelection);
    this.selection[1](selection);
  }
  setLastTouchedIndex(index: number) {
    return this.lastTouchedIndexSignal[1](index);
  }
  initProjection() {
    return createMemo<Node[]>(() => {
      const visibleChildren: Node[] = [];
      let n = new Node();
      n.isRoot = true;
      n.children = this.treeState.childrenSignal[0]();
      let index = 0;
      const isDragging = this.dndContext.isDragging[0]();
      // Flattens the tree
      walk<Node, Node>(n, (node) => {
        // Keeping the node that user actually dragged in place
        const dragOriginNode = node === this.originNode;
        if (dragOriginNode) {
          this.originIndex = index;
          index++;
        }
        // Skip root & other selected items
        const skip = node.isRoot || (isDragging && this.selection[0]().has(node) && !dragOriginNode && this.isOrigin);
        if (!skip) {
          index++;
          visibleChildren.push(node);
        }
        if (!node.expanded) return true;
      });
      return visibleChildren;
    });
  }
  // Projection of list i.e. visible children, often filtered by dragged items
  getWindowedSignal(containerVector: Accessor<ContainerVector>): VirtualisedList {
    // Virtualisation
    return createMemo(() => {
      const rowHeight = this.itemHeight;
      const [containerHeight, offset] = containerVector();
      const buffer = 20; // TODO: Buffer should be linked to scroll change required to update
      const excess = (offset % rowHeight);
      const start = Math.max(0, (offset - excess) - (buffer * rowHeight)) / rowHeight;
      const renderCount = Math.floor(containerHeight / rowHeight) + (buffer * 2);
      let window = this.projection().slice(start, start + renderCount);
      return {
        window,
        start,
      }
    })
  }
  /**
   * This count includes total item count minus the selected items (excluding origin) when dragging
   * or total count generally
   */
  presentCount() {
    return createMemo(() => {
      if (this.dndContext.isDragging[0]() && this.isOrigin) {
        return this.treeState.count()() - this.selection[0]().size + 1;
      } else {
        return this.treeState.count()();
      }
    })
  }
}

// There is only one drag context, but there can be multiple select contexts
// This mostly controls the dragged item
export class DndContext {
  isDragging = createSignal(false);
  activeContext = createSignal<string | null>(null); // TODO: Use
  listContexts = new Set<ListDragContext>();
  draggedEl: HTMLElement | null = null; // Clone of element that was dragged
  elClickOffset = [0, 0];
  dragMove = createSignal<[number, number]>([-100, -100]); // TODO: Don't render instead of storing off screen
  constructor() { }
  startDrag(ref: HTMLElement, elClickOffset: [number, number] = [0, 0]) {
    // Set up dragged element
    this.elClickOffset = elClickOffset;
    this.draggedEl = ref.cloneNode(true);
    this.isDragging[1](true);
  }
  checkLeave(el: Element) {
    this.listContexts.forEach((ctx) => {
      if (ctx.dragOver[0]()) {
        const contains = ctx.scrollContainerRef?.contains(el);
        if (!contains) ctx.leave();
      }
    })
  }
  /** mouse or touch coords */
  moveDragCoords(x: number, y: number) {
    this.dragMove[1]([x, y]);
  }
  onDragMove(callback: (coords: [number, number]) => void) {
    return createEffect(() => {
      callback(this.dragMove[0]())
    });
  }
  stopDrag() {
    this.elClickOffset = [0, 0];
    this.draggedEl = null;
    this.isDragging[1](false);
  }
}
