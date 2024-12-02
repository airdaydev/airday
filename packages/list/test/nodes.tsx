import styles from "./dev.module.css";
import { NodeComponentType, Node, GenericNode } from "../src/index";

interface TextNodeProps extends GenericNode<TextNodeProps> {
  content?: string;
}

export class TextNode extends Node {
  type = "text";
  allowChildren = true;
  content?: string;
  component = TextNodeComponent;
  constructor(node: TextNodeProps) {
    super(node);
    if (node.content) this.content = node.content;
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

export function loader(node: { id: string; content: string }) {
  return new TextNode({
    id: node.id,
    content: node.content,
  });
}

export const TextNodeComponent: NodeComponentType<TextNode> = (props) => {
  const node = props.node.accessor;
  return (
    <div
      aria-selected={props.ariaSelected}
      aria-expanded={node().expanded}
      classList={{
        [styles["tree-item"]]: true,
        // [styles["child_selected"]]: props.childSelected,
      }}
      onDragStart={(event) => {
        props.onDragStart(event);
      }}
      onMouseDown={(event) => {
        props.onMouseDown(event);
      }}
      draggable="true"
      onTouchStart={() => {
        // props.onTouchStart(event);
      }}
      onDblClick={(event) => {
        event.preventDefault();
        props.select();
        props.node.updateContent("gogogoo");
      }}
      ref={props.ref}
      style={{
        "padding-left": `${(props.node.accessor().depth - 1) * 10}px`,
      }}
    >
      <div
        class={styles["item-margin"]}
        onMouseEnter={() => {
          if (
            props.ctx.dndContext.isDragging() &&
            props.node?.children.length
          ) {
            props.ctx.dndContext.dragContext[1](() => null);
            props.node.expand();
            return;
          }
          // props.onMouseEnter(event);
        }}
      >
        {props.node?.children.length && (
          <button
            class={styles["expand"]}
            onmousedown={() => props.toggleExpansion()}
          >
            <img src="./caret.svg" />
          </button>
        )}
      </div>
      <div class={styles["item-internal"]}>
        {node().id} - {node().content} d:{props.node.depth}
      </div>
    </div>
  );
};
