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
      aria-selected={props.ariaSelected}
      aria-expanded={node().expanded}
      classList={{
        [styles["tree-item"]]: true,
        [styles["child_selected"]]: props.childSelected,
      }}
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
      style={{
        "padding-left": `${(props.node.accessor().depth - 1) * 10}px`,
      }}
    >
      <div
        class={styles["item-margin"]}
        onMouseEnter={(event) => {
          if (
            props.ctx.dndContext.isDragging() &&
            props.node?.children.length
          ) {
            props.ctx.dndContext.dragContext[1](() => null);
            props.ctx.setLastTouchedIndex(null);
            props.node.expand();
            return;
          }
          // props.onMouseEnter(event);
        }}
      >
        {props.node?.children.length && (
          <button
            class={styles["expand"]}
            onClick={() => props.node.toggleExpansion()}
          >
            <img src="/public/caret.svg" />
          </button>
        )}
      </div>
      <div onMouseEnter={props.onMouseEnter} class={styles["item-internal"]}>
        {node().id} - {node().content} d:{props.node.depth}
      </div>
    </div>
  );
};
