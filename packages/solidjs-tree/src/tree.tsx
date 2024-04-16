import { mergeProps } from 'solid-js';
import styles from './main.module.css';

const Node = (props: any) => {
  const merged = mergeProps({ depth: 0 }, props);
  const signal = props.node.getSignal();
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
        <Node node={child} depth={merged.depth+1} />
      ))}
    </>
  )
};

// TODO: Virtualise this
export const Tree = (props) => {
  return (
    <div style={`
    background: yellow;
    color: black;
    width: 18em;
    height: 25em;
    overflow-y: scroll;
    `}>
      {props.items.children.map((node) => (
        <Node node={node} />
      ))}
    </div>
  );
};
