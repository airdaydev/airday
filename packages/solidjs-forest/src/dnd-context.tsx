import { createSignal } from 'solid-js';
import { TreeState, type Node as ForestNode } from './state';

// There is only one drag context, but there can be multiple select contexts
// This mostly controls the dragged item
export class DndContext {
  isDragging = createSignal(false);
  originContainer: HTMLElement | null = null;
  activeContainer: HTMLElement | null = null;
  // targetState = createSignal<TreeState | null>(null);
  draggedEl: HTMLElement | Node | undefined;
  elClickOffset = [0, 0]; // prev, dragClickOffset
  originNode: ForestNode | undefined; // prev, dragOriginNode The actual node that the user clicked on
  lastTouchedIndex = createSignal<number | undefined>(); // prev, dragLastTouched
  dragOriginNodeIndex: number | undefined;
  constructor() { }
  setActiveContainer(container: HTMLElement) {
    console.log('setting active container', container)
    this.activeContainer = container;
  }
  setLastTouchedIndex(nodeIndex: number | undefined) {
    this.lastTouchedIndex[1](nodeIndex);
  }
  startDrag(dragOriginNode: Node, ref: HTMLElement, elClickOffset: [number, number] = [0, 0], containerRef: HTMLElement) {
    this.elClickOffset = elClickOffset;
    this.draggedEl = ref.cloneNode(true);
    this.originNode = dragOriginNode;
    dragOriginNode.setDragOriginState(true)
    this.isDragging[1](true);
  }
  stopDrag() {
    this.elClickOffset = [0, 0];
    this.setLastTouchedIndex(undefined);
    this.originNode?.setDragOriginState(false)
    this.originNode = undefined;
    this.isDragging[1](false);
  }
}
