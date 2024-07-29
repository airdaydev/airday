import { onCleanup, Component, Accessor, on, createEffect, createSignal, createMemo } from 'solid-js';
import { Node } from './state';
import { distance } from './utils';
import styles from './default.module.css';
import './root.css';
import { ListDragContext } from './dnd-context';

export interface NodeContainerProps {
  node: Node;
  Component: NodeComponentType;
  treeIndex: Accessor<number>;
  listDragContext: ListDragContext;
}

const defaultStyle = {
  item_when: (height = '26px') => {

  }
}

export const NodeContainer = (props: NodeContainerProps) => {
  let ref: HTMLElement;
  const isSelected = props.listDragContext.isSelected(props.node);
  onCleanup(() => props.node.unsubscribe());
  const draggedOn = createSignal(0);
  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault(); // prevents selection on Safari
    if (event.button === 2) return; // prevent context menu
    props.listDragContext.selectOne(props.node);
    const origin: [number, number] = [event.clientX, event.clientY];
    const mouseMove = (mouseMoveEvent: MouseEvent) => {
        event.preventDefault();
        // Make moving a little more effort to avoid slips
        if (distance(origin, [mouseMoveEvent.clientX, mouseMoveEvent.clientY]) > 3) {
          const targetBounding = event.target.getBoundingClientRect();
          const targetOffset = [event.pageX - targetBounding.x, event.pageY - targetBounding.y] as [number, number];
          // Start dragging
          props.listDragContext.startDrag(props.treeIndex(), props.node, ref, targetOffset);
          window.removeEventListener('mousemove', mouseMove);
          window.addEventListener('mouseup', () => {
            props.listDragContext.stopDrag();
            window.removeEventListener('mousemove', mouseMove);
          }, { once: true });
        }
    };
    window.addEventListener('mousemove', mouseMove);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mouseMove));
  };
  const isDragOrigin = createMemo(() => {
    const trigger = props.listDragContext.dndContext.isDragging[0]();
    return props.node === props.listDragContext.originNode;
  });
  // Determines how the node reacts as a list item (typically, shifting up and down)
  // originIndex: index of the item being moved (or 0 in the case of foreign list)
  // index: current item's tree index
  // lastTouchedIndex: last hit by user
  createEffect(
    // TODO: only observer individual list is dragging!!
    on(() => [
      props.listDragContext.lastTouchedIndexSignal[0](),
      props.listDragContext.dndContext.isDragging[0](),
      props.listDragContext.dragOver[0](),
    ],
    ([lastTouchedIndex, isDragging, dragOver]) => {
      if (!isDragging) {
        draggedOn[1](0);
        return;
      }
      const index = props.treeIndex();
      const originIndex = props.listDragContext.originIndex as number;
      if (!props.listDragContext.isOrigin && dragOver) {
        if (index >= lastTouchedIndex) {
          draggedOn[1](-1);
        } else {
          draggedOn[1](0);
        }
        return;
      }
      // When dragging & leaving the origin list, the placeholder needs to disappear.
      // The placeholder could be part of the origin object, or covered by other objects
      // when the mouse is moved below or above.
      // Strategy: Everything below the origin object needs to have “above” class appended,
      // and no “below” classes need to be appended, when the list is not being hovered over.
      if (!dragOver && props.listDragContext.isOrigin) {
        let result = 0;
        if (originIndex < index) result = 1;
        if (originIndex > index) result = 0;
        draggedOn[1](result);
        return;  
      }
      // Drag origin (o) replaced with placeholder on initial drag.
      // Moving up, pushes o-1 down, exposing its placeholder.
      // Moving down, pushes o+1 up, exposing its placeholder.
      if (lastTouchedIndex === null) {
        draggedOn[1](0);
        return;
      }
      if (originIndex < index && lastTouchedIndex >= index) {
        // is below
        draggedOn[1](1);
        return;
      } else if (originIndex > index && lastTouchedIndex <= index) {
        draggedOn[1](-1);
        return;
      } else {
        draggedOn[1](0);
      }
  }));
  /**
   * Hiding the placeholder:
   * We have 3 placeholders (up/down & origin)
   * Hide neutral when container is not actively being dragged over
   * Hide up when container is not actively being dragged over
   * Hide down when container is not actively being dragged over
   * Need to revert as if there's no above/below classes!
   */
  return (
    <div
      class="item"
      // style={{ height: signal().isDragOrigin && !isActiveContainer() ? '0': '26px' }}
    >
      {draggedOn[0]() === -1 && (
        <div class='placeholder' />
      )}
      {isDragOrigin() && (<div class={'placeholder'} />)}
      {!isDragOrigin() && (
        <div
          classList={{
            item_internal: true,
            above: draggedOn[0]() === 1,
            below: draggedOn[0]() === -1,
            // Ok but a bit janky, can we set last touched / draggedOn to neutral...?
          }}
          onMouseEnter={() => {
            // This looks at where the previous draggedOn index was, as its final position
            // is determined by whether the user drags up or down onto it.
            // N.b. the sequence here prevents a flicker on drag start.
            const draggingOver = props.treeIndex();
            const newIndex = draggingOver - draggedOn[0]();
            props.listDragContext.setLastTouchedIndex(newIndex);
            props.listDragContext.dragOver[1](true);
            if (!props.listDragContext.dndContext.isDragging[0]()) return;
          }}
        >
          <props.Component
            onMouseDown={onMouseDown}
            node={props.node}
            ariaSelected={isSelected()}
            select={() => props.listDragContext.selectOne(props.node)}
            ref={ref}
          />
          </div>
      )}
      {draggedOn[0]() === 1 && props.listDragContext.dragOver[0]() && (
        <div class='placeholder' />
      )}
    </div>
  );
};

export type NodeComponentType = Component<{
  node: Node,
  ariaSelected: boolean,
  onMouseDown: (event: MouseEvent) => void,
  select: () => void,
}>;

export const DefaultNodeComponent: NodeComponentType = (props) => {
  return (
    <div
      aria-selected={props.ariaSelected}
      class={styles['tree-item']}
      onMouseDown={props.onMouseDown}
    >
      {props.node.id}
    </div>
  )
}
