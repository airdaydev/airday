import { Node, GenericNode } from "@sunlist/list";
import { GenericComponent } from "../item/item";
import { v, compile } from "suretype";
import type { TypeOf } from "suretype";
import { createUniqueId } from "solid-js";
import { ItemStore } from "./item";
import { SunlistWorkspace } from "./main";

const GenericItemSchema = v.object({
  id: v.string(),
  content: v.string(),
  tsCompleted: v.any(), // TODO: Validate date
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
  workspace: SunlistWorkspace;
  static validate = compile(GenericItemSchema, { simple: true });
  constructor(props: GenericItemSchema, workspace: SunlistWorkspace) {
    super(props);
    this.id = props.id || createUniqueId();
    this.content = props.content;
    this.tsCompleted = props.tsCompleted;
    this.workspace = workspace;
  }
  serialise() {
    return {
      id: this.id,
      content: this.content,
      tsCompleted: this.tsCompleted,
    };
  }
  updateContent(newText: string) {
    this.content = newText;
    this.triggerUpdate();
    this.workspace.itemStore.update(this.id, { content: newText });
  }
  // If toggling off, this should stay in its parent list for 2 seconds but grey before disappearing
  // deleting from memory list & moving to done memory list (having 2 items simultaneously may be confusing)
  // the state update, however, should take place immediately
  // because of the specificity of the transaction, it's better we create actions with specific instructions
  // at the place of construction``
  toggleComplete() {
    if (!this.tsCompleted) {
      this.tsCompleted = new Date();
    } else {
      this.tsCompleted = null;
    }
    this.triggerUpdate();
    // TODO: Continue
    const update = {
      type: "local-item-complete",
      id: this.id,
      tsCompleted: this.tsCompleted,
    };
    this.workspace.itemStore.update(this.id, { tsCompleted: this.tsCompleted });
  }
}

export function itemLoader(workspace: SunlistWorkspace) {
  return function loader(data: any) {
    // if (data.type === "generic") {
    const validated = GenericItem.validate(data);
    if (!validated) return false;
    return new GenericItem(data, workspace);
    // }
    console.warn("invalid data in container loader");
    return false;
  };
}
