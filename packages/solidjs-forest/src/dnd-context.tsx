import { createSignal, createUniqueId } from 'solid-js';
import { type Node as ForestNode } from './state';

// Per list dnd context
export class ListDragContext {
  id = createUniqueId()
  container: HTMLElement | null = null;
  originIndex: number | null = null; // TODO: This could move if other items are inserted
  isOrigin = createSignal<boolean>(); // TODO: hmm
  lastTouchedIndexSignal = createSignal<number | undefined>();
  dndContext: DndContext;
  originNode: ForestNode | undefined; // prev, dragOriginNode The actual node that the user clicked on
  dragOriginNodeIndex: number | undefined;
  constructor(dndContext: DndContext) {
    this.dndContext = dndContext;
  }
  startDrag(originNode: ForestNode, ref: HTMLElement, elClickOffset: [number, number] = [0, 0]) {
    this.originNode = originNode;
    this.dndContext.startDrag(ref, elClickOffset);
  }
  stopDrag() {
    this.reset();
    this.dndContext.stopDrag();
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
  elClickOffset = [0, 0];
  constructor() { }
  // setActiveContainer(container: HTMLElement) {
  //   console.log('setting active container', container)
  //   this.activeContainer[1](container);
  // }
  startDrag(ref: HTMLElement, elClickOffset: [number, number] = [0, 0]) {
    console.log('start drag');
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
