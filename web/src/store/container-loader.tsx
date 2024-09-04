import { Node, GenericNode } from "@borde/list";
import { GenericComponent } from "../item/item";
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
  type = "generic";
  tsCreated?: Date;
  sticker?: string;
  component = GenericComponent;
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
  if (data.type === "generic") {
    const validated = GenericList.validate(data);
    console.log(validated);
    return data;
  }
  return new GenericList(data);
}
