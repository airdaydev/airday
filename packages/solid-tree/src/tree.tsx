import { mergeProps } from 'solid-js';
import styles from './main.module.css';

const Node = (props: any) => {
  const merged = mergeProps({ depth: 0 }, props);
  return (
    <>
      <div class={styles['tree-item']} aria-level={merged.depth} onClick={() => console.log(props.item)}>
        {props.item.id}
      </div>
      {props.item.children?.map((child) => (
        <Node item={child} depth={merged.depth+1} />
      ))}
    </>
  )
};

export const Tree = (props) => {
  return (
    <div style={`
    background: yellow;
    color: black;
    width: 18em;
    height: 25em;
    overflow-y: scroll;
    `}>
      {props.items.children.map((item) => (
        <Node item={item} />
      ))}
    </div>
  );
};
