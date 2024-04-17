import { For, onCleanup, Component } from 'solid-js';
import { distance } from './utils';
import styles from './main.module.css';
import { Node, RootNode } from './state';

interface NodeContainerProps {
  node: Node;
  Component: NodeComponent,
}

const NodeContainer = (props: NodeContainerProps) => {
  const signal = props.node.getNodeSignal();
  onCleanup(() => props.node.unsubscribe());
  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault(); // prevents selection on Safari
    if (props.node.isSelected) {
      props.node.deselect();
    } else {
      props.node.select();
    }
    const origin: [number, number] = [event.clientX, event.clientY];
    const mouseMove = (mouseUpEvent: MouseEvent) => {
        event.preventDefault();
        // Make moving a little more effort to avoid slips
        if (distance(origin, [mouseUpEvent.clientX, mouseUpEvent.clientY]) > 3) {
          props.node.root.isDragging = true;
        }
        window.addEventListener('mouseup', () => {
          props.node.root.isDragging = false;
          window.removeEventListener('mousemove', mouseMove);
        }, { once: true })
    };
    window.addEventListener('mousemove', mouseMove);
  };
  return (
    <>
      <props.Component
        onMouseDown={onMouseDown}
        node={props.node}
        ariaSelected={signal().isSelected}
      />
    </>
  );
};

export type NodeComponent = Component<{
  node: Node,
  ariaSelected: boolean,
  onMouseDown: (event: MouseEvent) => void,
}>;

export const DefaultNodeComponent: NodeComponent = (props) => {
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

interface TreeComponentProps {
  rootNode: RootNode,
  NodeComponent?: NodeComponent,
}

// TODO: Virtualise this
export const Tree = (props: TreeComponentProps) => {
  let containerRef: HTMLDivElement | undefined;
  const kbHandler = (event: KeyboardEvent) => {
    // only if focused on this ref!
    if (event.key === 'Backspace') {
      props.rootNode.delete(props.rootNode.selection);
    }
  };
  document.addEventListener('keyup', kbHandler)
  onCleanup(() => {
    document.removeEventListener('keydown', kbHandler)
  });
  return (
    <div
      ref={containerRef}
      style={`
        background: yellow;
        color: black;
        width: 18em;
        height: 25em;
        overflow-y: scroll;
      `}
      >
      <For each={props.rootNode.getWindowedSignal(containerRef!)()}>
        {(node, index) => (
          <NodeContainer node={node} Component={props.NodeComponent || DefaultNodeComponent} />
        )}
      </For>
    </div>
  );
};
