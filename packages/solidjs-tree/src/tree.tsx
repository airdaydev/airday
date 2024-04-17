import { For, mergeProps, onCleanup } from 'solid-js';
import styles from './main.module.css';
import { Node, RootNode } from './state';

interface NodeComponentProps {
  node: Node;
}

const NodeComponent = (props: NodeComponentProps) => {
  const merged = mergeProps({ depth: 0 }, props);
  const signal = props.node.getNodeSignal();
  onCleanup(() => props.node.unsubscribe());
  return (
    <>
      <div
        class={styles['tree-item']}
        aria-level={merged.depth}
        onClick={() => {
          if (props.node.isSelected) {
            props.node.deselect();
          } else {
            props.node.select();
          }
        }}
        aria-selected={signal().isSelected}
      >
        {props.node.id}
      </div>
      {props.node.children?.map((child) => (
        <NodeComponent node={child} depth={merged.depth+1} />
      ))}
    </>
  );
};

// TODO: Virtualise this
export const Tree = (props: { rootNode: RootNode }) => {
  return (
    <div style={`
    background: yellow;
    color: black;
    width: 18em;
    height: 25em;
    overflow-y: scroll;
    `}>
      <For each={props.rootNode.windowedSignal()()}>
        {(node, index) => (
          <NodeComponent node={node} />
        )}
      </For>
    </div>
  );
};
