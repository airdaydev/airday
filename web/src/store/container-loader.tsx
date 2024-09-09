import { Node, GenericNode } from "@borde/list";
import { NavListItem } from "../nav/nav-lists";
import { v, compile } from "suretype";
import type { TypeOf } from "suretype";
import { createUniqueId } from "solid-js";

const GenericListSchema = v.object({
  id: v.string(),
  name: v.string(),
});

type GenericListSchema = TypeOf<typeof GenericListSchema> & GenericNode<any>;

export class GenericList extends Node {
  id: string;
  name: string;
  type = "generic-list";
  tsCreated?: Date;
  sticker?: string;
  component = NavListItem;
  static validate = compile(GenericListSchema, { simple: true });
  constructor(props: GenericListSchema) {
    super(props);
    this.id = props.id || createUniqueId();
    this.name = props.name || "";
  }
  serialise() {
    return {
      id: this.id,
      name: this.name,
    };
  }
  updateName(newName: string) {
    this.name = newName;
    this.triggerUpdate();
  }
}

export function containerLoader(data: any) {
  if (data.type === "generic-list") {
    const validated = GenericList.validate(data);
    if (!validated) return false;
    return new GenericList(data);
  }
  console.warn("invalid data in container loader");
  return false;
}
