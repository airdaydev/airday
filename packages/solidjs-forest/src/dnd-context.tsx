import { createSignal } from 'solid-js';
import { TreeState, type Node as ForestNode } from './state';

// There is only one drag context, but there can be multiple select contexts
// This mostly controls the dragged item
export class DndContext {
  isDragging = createSignal(false);
  originState = createSignal<TreeState | null>(null); // also euphanism for is dragging (todo: separate for clarity?)
  activeTreeContainer = createSignal<HTMLElement | null>(null);
  // targetState = createSignal<TreeState | null>(null);
  draggedEl: HTMLElement | Node | undefined;
  elClickOffset = [0, 0]; // prev, dragClickOffset
  originNode: ForestNode | undefined; // prev, dragOriginNode The actual node that the user clicked on
  lastTouchedIndex = createSignal<number | undefined>(); // prev, dragLastTouched
  dragOriginNodeIndex: number | undefined;
  constructor() {

  }
  setLastTouchedIndex(nodeIndex: number | undefined) {
    this.lastTouchedIndex[1](nodeIndex);
  }
  startDrag(originNode: ForestNode, ref: HTMLElement | Node, dragClickOffset: [number, number] = [0, 0]) {
    this.elClickOffset = dragClickOffset;
    this.draggedEl = ref.cloneNode(true);
    this.originNode = originNode;
    this.targetState[1](this.originNode.root);
    originNode.setDragOriginState(true)
  }
  setActiveDropTarget(target: TreeState | null) {
    this.targetState[1](target);
  }
  stopDrag() {
    this.elClickOffset = [0, 0];
    this.setLastTouchedIndex(undefined);
    this.originNode?.setDragOriginState(false)
    this.originNode = undefined;
    this.targetState[1](null);
  }
}
