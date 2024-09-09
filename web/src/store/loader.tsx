import { Node, GenericNode } from "@borde/list";
import { GenericComponent } from "../item/item";
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
  // if (data.type === "generic") {
  const validated = GenericItem.validate(data);
  if (!validated) return false;
  return new GenericItem(data);
  // }
  console.warn("invalid data in container loader");
  return false;
}
