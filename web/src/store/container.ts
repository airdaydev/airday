import { Node, GenericNode } from "@sunlist/list";
import { ContainerNodeComponent, FolderNodeComponent } from "../nav/nav-lists";
import { v, compile } from "suretype";
import type { TypeOf } from "suretype";
import { createUniqueId } from "solid-js";

const ContainerNodeSchema = v.object({
  id: v.string(),
  name: v.string(),
  icon: v.string(),
  default: v.boolean(),
});

type ContainerNodeSchema = TypeOf<typeof ContainerNodeSchema> &
  GenericNode<any>;

export class ContainerNode extends Node {
  id: string;
  name: string;
  type = "generic-list";
  tsCreated?: Date;
  component = ContainerNodeComponent;
  default: boolean = false;
  icon?: string;
  static validate = compile(ContainerNodeSchema, { simple: true });
  constructor(props: ContainerNodeSchema) {
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

const ContainerFolder = v.object({
  id: v.string(),
  name: v.string(),
  icon: v.string(),
  default: v.boolean(),
});

type ContainerFolder = TypeOf<typeof ContainerNodeSchema> & GenericNode<any>;

export class ContainerFolderNode extends Node {
  id: string;
  name: string;
  type = "folder";
  tsCreated?: Date;
  component = FolderNodeComponent;
  default: boolean = false;
  expanded = true;
  icon?: string;
  static validate = compile(ContainerNodeSchema, { simple: true });
  constructor(props: ContainerNodeSchema) {
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
    const validated = ContainerNode.validate(data);
    if (!validated) return false;
    return new ContainerNode(data);
  }
  if (data.type === "folder") {
    const validated = ContainerFolderNode.validate(data);
    if (!validated) return false;
    return new ContainerFolderNode(data);
  }
  console.warn("invalid data in container loader");
  return false;
}
