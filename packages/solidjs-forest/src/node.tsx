import { onCleanup, Component, Accessor, on, createEffect, createSignal } from 'solid-js';
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
  const signal = props.node.accessor;
  onCleanup(() => props.node.unsubscribe());
  const draggedOn = createSignal(0);
  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault(); // prevents selection on Safari
    if (event.button === 2) return; // prevent context menu
    props.node.select();
    const origin: [number, number] = [event.clientX, event.clientY];
    const mouseMove = (mouseMoveEvent: MouseEvent) => {
        event.preventDefault();
        // Make moving a little more effort to avoid slips
        if (distance(origin, [mouseMoveEvent.clientX, mouseMoveEvent.clientY]) > 3) {
          const targetBounding = event.target.getBoundingClientRect();
          const targetOffset = [event.pageX - targetBounding.x, event.pageY - targetBounding.y] as [number, number];
          // Start dragging
          props.listDragContext.startDrag(props.node, ref, targetOffset);
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
  // Determines how the node reacts as a list item (typically, shifting up and down)
  createEffect(
    // TODO: only observer individual list is dragging!!
    on(() => [props.listDragContext.lastTouchedIndexSignal[0](), props.listDragContext.dndContext.isDragging[0]()],
    ([lastTouchedIndex, isDragging]) => {
      if (!isDragging) {
        draggedOn[1](0);
        return;
      }
      const index = props.treeIndex();
      const originIndex = props.listDragContext.originIndex as number;
      // Drag origin is before node
      // last touched index 
      if (!lastTouchedIndex) {
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
  const isActiveContainer = () => {
    // return props.containerRef === props.node.root?.dndContext.activeContainer[0]();
    return true;
  }
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
      {draggedOn[0]() === -1 && isActiveContainer() && (
        <div class='placeholder' />
      )}
      {signal().isDragOrigin && (<div class={'placeholder'} />)}
      {!signal().isDragOrigin && (
        <div
          classList={{
            item_internal: true,
            above: draggedOn[0]() === 1,
            below: draggedOn[0]() === -1,
            // Ok but a bit janky, can we set last touched / draggedOn to neutral...?
          }}
          onMouseEnter={() => {
            if (!props.listDragContext.dndContext.isDragging[0]()) return;
            // On dragging over an item, if the container is a remote container &
            // does not match the current active container, set this item as the pseudo item.
            // if (!isActiveContainer()) {
            //   props.node.root.dndContext.setActiveContainer(props.containerRef);
            //   // TODO: Set remote initial!!
            //   // if ()
            //   // props.node.root.dndContext.remoteInitial = 
            // }
            const draggingOver = props.treeIndex();
            props.listDragContext.setLastTouchedIndex(draggingOver - draggedOn[0]());
          }}
        >
          <props.Component
            onMouseDown={onMouseDown}
            node={props.node}
            ariaSelected={signal().isSelected}
            ref={ref}
          />
          </div>
      )}
      {draggedOn[0]() === 1 && isActiveContainer() && (
        <div class='placeholder' />
      )}
    </div>
  );
};

export type NodeComponentType = Component<{
  node: Node,
  ariaSelected: boolean,
  onMouseDown: (event: MouseEvent) => void,
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
