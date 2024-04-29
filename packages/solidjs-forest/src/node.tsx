import { onCleanup, Component, Accessor, on, createEffect, createSignal } from 'solid-js';
import { Node } from './state';
import { distance } from './utils';
import styles from './default.module.css';
import './root.css';

export interface NodeContainerProps {
  node: Node;
  Component: NodeComponentType;
  treeIndex: Accessor<number>;
  containerRef: HTMLElement;
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
          // mouseUpEvent.
          props.node.root?.startDrag(props.node, ref, targetOffset);
          window.removeEventListener('mousemove', mouseMove);
        }
        window.addEventListener('mouseup', () => {
          props.node.root?.stopDrag();
          window.removeEventListener('mousemove', mouseMove);
        }, { once: true });
    };
    window.addEventListener('mousemove', mouseMove);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mouseMove));
  };
  // TODO: Can we only run this when active...? (derivative signal??)
  createEffect(on(() => props.node.root?.dndContext.lastTouchedIndex[0](), (lastTouchedIndex) => {
    // console.log(props.containerRef)
    const isInActiveContainer = props.containerRef === props.node.root?.dndContext.activeTreeContainer[0]();
    if (!isInActiveContainer) {
      draggedOn[1](0);
      return;
    }
    // console.log('isInActiveContainer', isInActiveContainer);
    const index = props.treeIndex();
    const dragOriginNodeIndex = props.node.root?.dragOriginNodeIndex;
    // Drag origin is before node
    // last touched index 
    if (dragOriginNodeIndex < index && lastTouchedIndex >= index) {
      // is below
      draggedOn[1](1);
      return;
    } else if (dragOriginNodeIndex > index && lastTouchedIndex <= index) {
      draggedOn[1](-1);
      return;
    } else {
      draggedOn[1](0);
    }
    // if ((props.node.root?.dragOriginNodeIndex > lastTouchedIndex)) {
      //   draggedOn[1](index > lastTouchedIndex ? -1 : 0);
      //   console.log('above')
      // }
  }));
  return (
    <div
      class="item"
    >
      {draggedOn[0]() === -1 && (
        <div class='placeholder' />
      )}
      {signal().isDragOrigin && (<div class={'placeholder'} />)}
      {!signal().isDragOrigin && (
        <div
          classList={{
            item_internal: true,
            above: draggedOn[0]() === 1,
            below: draggedOn[0]() === -1,
          }}
          onMouseEnter={() => {
            if (props.node.root?.dndContext.isDragging[0]()) {
              const draggingOver = props.treeIndex();
              props.node.root.dndContext.lastTouchedIndex[1](draggingOver - draggedOn[0]());
            }
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
      {draggedOn[0]() === 1 && (
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
