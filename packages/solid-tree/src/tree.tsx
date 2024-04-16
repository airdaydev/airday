import styles from './main.module.css';

const TreeItem = (props: any) => {
  return (
    <div class={styles['tree-item']}>
      {props.item.id}
      {props.item.children?.map((child) => (
        <TreeItem item={child} />
      ))}
    </div>
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
        <TreeItem item={item} />
      ))}
    </div>
  );
};
