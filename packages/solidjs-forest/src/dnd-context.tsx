import { createMemo, createSignal, createUniqueId } from 'solid-js';
import { Node, TreeState } from './state';
import { walk } from './tree-utils';

// Per list dnd context
export class ListDragContext {
  id = createUniqueId();
  treeState: TreeState;
  container: HTMLElement | null = null;
  selection = createSignal(new Set<Node>);
  originIndex: number | null = null; // TODO: This could move if other items are inserted...
  isOrigin = false; // true = this is the list where the user has dragged from
  dragOver = createSignal(false); // Is the user currently dragging over this list
  lastTouchedIndexSignal = createSignal<number | undefined>();
  dndContext: DndContext;
  originNode: Node | null = null; // prev, dragOriginNode The actual node that the user clicked on
  dragOriginNodeIndex: number | undefined;
  constructor(treeState: TreeState, dndContext: DndContext) {
    this.treeState = treeState;
    this.dndContext = dndContext;
  }
  isSelected(node: Node) {
    return createMemo(() => {
      const selection = this.selection[0]();
      return selection.has(node);
    })
  }
  leave() {
    if (this.dndContext.isDragging) this.dragOver[1](false)
    if (this.isOrigin) {
      return;
    }
    this.reset();
  }
  startDrag(originIndex: number, originNode: Node, ref: HTMLElement, elClickOffset: [number, number] = [0, 0]) {
    this.setLastTouchedIndex(originIndex);
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
    console.log('reset');
    this.isOrigin = false;
    this.originIndex = null;
    this.originNode = null;
    this.setLastTouchedIndex(0); // TODO: think about carefully, causes slight bug
  }
  selectOne(node: Node) {
    const selection = new Set([node]);
    this.selection[1](selection);
    // if (this.onSelectionChange) this.onSelectionChange(this.selection);
  }
  setContainer(container: HTMLElement) {
    this.container = container;
  }
  setLastTouchedIndex(index: number) {
    return this.lastTouchedIndexSignal[1](index);
  }
  getWindowedSignal() {
    // Window notes:
    // scrolloffset * heights, so we need a cached count of all items or filtered items,
    // - dragged items - collapsed items
    // Dragged items are replaced with a diminishing block,
    // Deleting items???????
    // But the block cannot factor into the window calculation, the window is the end result
    
    // const totalHeight = visibleChildren.length * 22.2;
    // calculate & cache heights, filtering out contiguous blocks removed
    // if scrolloffset > total height, move scroll loc to Math.min(0, scrollOffset - containerHeight)
    // otherwise first index = scrolloffset - totalHeight/rowHeight
    // pull front padding + content (windows size should be bigger than needed in both directions if possible) + end padding
    // listen for scroll & resize events on container
    // Cache if possible to optimise
    return createMemo(() => {
      const visibleChildren: Node[] = [];
      let n = new Node();
      n.isRoot = true;
      n.children = this.treeState.childrenSignal[0]();
      // const end = qperf('memo');
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
      // end();
      // TODO: memo code here
      let window = visibleChildren.slice(0, 100);
      return window;
    });
  }
}

// There is only one drag context, but there can be multiple select contexts
// This mostly controls the dragged item
export class DndContext {
  isDragging = createSignal(false);
  activeContext = createSignal<string | null>(null);
  draggedEl: HTMLElement | null = null; // Clone of element that was dragged
  elClickOffset = [0, 0];
  constructor() { }
  // setActiveContainer(container: HTMLElement) {
  //   console.log('setting active container', container)
  //   this.activeContainer[1](container);
  // }
  startDrag(ref: HTMLElement, elClickOffset: [number, number] = [0, 0]) {
    // Set up dragged element
    this.elClickOffset = elClickOffset;
    this.draggedEl = ref.cloneNode(true);
    this.isDragging[1](true);
  }
  stopDrag() {
    this.elClickOffset = [0, 0];
    this.draggedEl = null;
    this.isDragging[1](false);
  }
}
