import { createSignal } from 'solid-js';
import { TreeState, type Node as ForestNode } from './state';

// There is only one drag context, but there can be multiple select contexts
export class DndContext {
  activeOrigin = createSignal<TreeState | null>(null);
  activeTarget = createSignal<TreeState | null>(null);
  draggedEl: HTMLElement | Node | undefined; // prev, dragEl
  elClickOffset = [0, 0]; // prev, dragClickOffset
  originNode: ForestNode | undefined; // prev, dragOriginNode The actual node that the user clicked on
  lastTouchedIndex = createSignal<number | undefined>(); // prev, dragLastTouched
  setLastTouchedIndex(nodeIndex: number | undefined) {
    this.lastTouchedIndex[1](nodeIndex);
  }
  startDrag(originNode: ForestNode, ref: HTMLElement | Node, dragClickOffset: [number, number] = [0, 0]) {
    this.elClickOffset = dragClickOffset;
    this.draggedEl = ref.cloneNode(true);
    this.originNode = originNode;
    originNode.setDragOriginState(true)
    this.active[1](true);
  }
  stopDrag() {
    this.elClickOffset = [0, 0];
    this.setLastTouchedIndex(undefined);
    this.originNode?.setDragOriginState(false)
    this.originNode = undefined;
    this.active[1](false);
  }
}
