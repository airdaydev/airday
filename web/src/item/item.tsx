import { NodeComponentType } from "@borde/list";
import { Checkbox } from "./checkbox";
import styles from "./item.module.css";

export const GenericComponent: NodeComponentType = (props) => {
  const node = props.node.accessor;
  return (
    <div
      aria-selected={props.ariaSelected}
      class={styles["tree-item"]}
      onMouseDown={(event) => {
        props.onMouseDown(event);
      }}
      onTouchStart={(event) => {
        props.onTouchStart(event);
      }}
      onDblClick={(event) => {
        event.preventDefault();
        props.select();
        props.node.updateContent("gogogoo");
      }}
      data-index={props.index}
      ref={props.ref}
    >
      <Checkbox
        onChange={(event: InputEvent) => {}}
        checked={!!node.tsCompleted}
      />
      <span>{node().content}</span>
    </div>
  );
};
