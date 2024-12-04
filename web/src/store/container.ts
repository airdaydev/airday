import { Node, GenericNode } from "@sunlist/list";
import { NavListItem } from "../nav/nav-lists";
import { v, compile } from "suretype";
import type { TypeOf } from "suretype";
import { createUniqueId } from "solid-js";

const GenericListSchema = v.object({
  id: v.string(),
  name: v.string(),
  icon: v.string(),
  default: v.boolean(),
});

type GenericListSchema = TypeOf<typeof GenericListSchema> & GenericNode<any>;

export class GenericList extends Node {
  id: string;
  name: string;
  type = "generic-list";
  tsCreated?: Date;
  component = NavListItem;
  default: boolean = false;
  icon?: string;
  static validate = compile(GenericListSchema, { simple: true });
  constructor(props: GenericListSchema) {
    super(props);
    this.id = props.id || createUniqueId();
    this.name = props.name || "";
    this.default = props.default || false;
    if (props.icon) this.icon = props.icon;
  }
  serialise() {
    return {
      id: this.id,
      name: this.name,
      default: this.default,
      icon: this.icon,
    };
  }
  updateName(newName: string) {
    this.name = newName;
    this.triggerUpdate();
  }
}

export class ContainerFolderNode extends Node {
  id: string;
  name: string;
  type = "folder";
  tsCreated?: Date;
  component = NavListItem;
  default: boolean = false;
  icon?: string;
  static validate = compile(GenericListSchema, { simple: true });
  constructor(props: GenericListSchema) {
    super(props);
    this.id = props.id || createUniqueId();
    this.name = props.name || "";
    this.default = props.default || false;
    if (props.icon) this.icon = props.icon;
  }
  serialise() {
    return {
      id: this.id,
      name: this.name,
      default: this.default,
      icon: this.icon,
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
