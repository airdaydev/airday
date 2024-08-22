import { NodeComponentType, Node, GenericNode } from "@borde/list";
import styles from "./item.module.css";
import { v, compile } from "suretype";
import type { TypeOf } from "suretype";
import { createUniqueId } from "solid-js";

const GenericItemSchema = v.object({
  id: v.string(),
  content: v.string(),
});

type GenericItemSchema = TypeOf<typeof GenericItemSchema> & GenericNode<any>;

export class GenericItem extends Node {
  id: string;
  type = "generic";
  allowChildren = true;
  tsCreated?: Date;
  tsCompleted?: Date | null;
  sticker?: string;
  content?: string;
  component = GenericComponent;
  static validate = compile(GenericItemSchema, { simple: true });
  constructor(props: GenericItemSchema) {
    super(props);
    this.id = props.id || createUniqueId();
    this.content = props.content;
  }
  serialise() {
    return {
      id: this.id,
      content: this.content,
    };
  }
  updateContent(newText: string) {
    this.content = newText;
    this.triggerUpdate();
  }
}

export function loader(data: any) {
  if (data.type === "generic") {
    const validated = GenericItem.validate(data);
    console.log(validated);
    return data;
  }
  return new GenericItem(data);
}

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
        // props.node.updateContent("gogogoo");
      }}
      data-index={props.index}
      ref={props.ref}
    >
      {node().id} - {node().content}
    </div>
  );
};
