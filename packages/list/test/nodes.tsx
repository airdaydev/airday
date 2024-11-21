import styles from "./dev.module.css";
import { NodeComponentType, Node, GenericNode } from "../src/index";

export class TextNode extends Node {
  type = "text";
  allowChildren = true;
  content?: string;
  component = TextNodeComponent;
  constructor(node) {
    super(node);
    this.content = node.content;
  }
  serialise() {
    return {
      content: this.content,
    };
  }
  updateContent(newText: string) {
    this.content = newText;
    this.triggerUpdate();
  }
}

export function loader(node: GenericNode<any>) {
  return new TextNode({
    id: node.id,
    content: node.content,
  });
}

export const TextNodeComponent: NodeComponentType = (props) => {
  const node = props.node.accessor;
  return (
    <div
      class={styles["tree-item-container"]}
      aria-selected={props.ariaSelected}
      aria-expanded={node().expanded}
    >
      <div class={styles["item-margin"]}>
        {props.node?.children.length && (
          <button
            class={styles["expand"]}
            onClick={() => props.node.toggleExpansion()}
          >
            <img src="/public/caret.svg" />
          </button>
        )}
      </div>
      <div
        class={styles["tree-item"]}
        onMouseDown={(event) => {
          props.onMouseDown(event);
        }}
        onMouseEnter={props.onMouseEnter}
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
        style={{
          "padding-left": `${(props.node.accessor().depth - 1) * 10}px`,
        }}
      >
        {node().id} - {node().content}
      </div>
    </div>
  );
};
