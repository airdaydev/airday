import { onCleanup, Component, Accessor } from 'solid-js';
import { Node } from './state';
import { distance } from './utils';
import styles from './main.module.css';
import './root.css';

export interface NodeContainerProps {
  node: Node;
  Component: NodeComponentType;
  treeIndex: Accessor<number>;
}

export const NodeContainer = (props: NodeContainerProps) => {
  const signal = props.node.accessor;
  onCleanup(() => props.node.unsubscribe());
  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault(); // prevents selection on Safari
    props.node.select();
    const origin: [number, number] = [event.clientX, event.clientY];
    const mouseMove = (mouseUpEvent: MouseEvent) => {
        event.preventDefault();
        // Make moving a little more effort to avoid slips
        if (distance(origin, [mouseUpEvent.clientX, mouseUpEvent.clientY]) > 3) {
          props.node.root?.startDrag(props.node);
        }
        window.addEventListener('mouseup', () => {
          props.node.root?.stopDrag();
          window.removeEventListener('mousemove', mouseMove);
        }, { once: true })
    };
    window.addEventListener('mousemove', mouseMove);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', mouseMove));
  };
  return (
    <div class="item">
      {signal().dragOriginNode && (<div style={'background: #ccc; height: 100%;'} />)}
      {!signal().dragOriginNode && (
        <props.Component
          onMouseDown={onMouseDown}
          node={props.node}
          ariaSelected={signal().isSelected}
        />
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
