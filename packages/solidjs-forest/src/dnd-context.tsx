import { createSignal } from 'solid-js';
import { type Node as ForestNode } from './state';

export class ListDragContext {
  container: HTMLElement | null = null;
  originIndex: number | null = null; // TODO: This could move if other items are inserted
  isOrigin = createSignal<boolean>(); // TODO: hmm
  lastTouchedIndexSignal = createSignal<number | undefined>();
  dndContext: DndContext;
  constructor(dndContext: DndContext) {
    this.dndContext = dndContext;
  }
  setContainer(container: HTMLElement) {
    this.container = container;
  }
  setLastTouchedIndex(index: number) {
    return this.lastTouchedIndexSignal[1](index);
  }
  reset() {
    this.setLastTouchedIndex(0);
    this.originIndex = null;
  }
}

// There is only one drag context, but there can be multiple select contexts
// This mostly controls the dragged item
export class DndContext {
  isDragging = createSignal(false);
  activeContext = createSignal<string | null>(null);
  draggedEl: HTMLElement | Node | null = null; // Clone of element that was dragged
  elClickOffset = [0, 0]; // prev, dragClickOffset
  originNode: ForestNode | undefined; // prev, dragOriginNode The actual node that the user clicked on
  dragOriginNodeIndex: number | undefined;
  constructor() { }
  // setActiveContainer(container: HTMLElement) {
  //   console.log('setting active container', container)
  //   this.activeContainer[1](container);
  // }
  startDrag(dragOriginNode: Node, ref: HTMLElement, elClickOffset: [number, number] = [0, 0], containerRef: HTMLElement) {
    const forestId = containerRef.getAttribute('x-forest-id');
    console.log('starting drag', forestId);
    // Set up dragged element
    this.elClickOffset = elClickOffset;
    this.draggedEl = ref.cloneNode(true);
    this.isDragging[1](true);
  }
  stopDrag() {
    console.log('stop drag');
    this.elClickOffset = [0, 0];
    this.draggedEl = null;
    this.isDragging[1](false);
  }
}
