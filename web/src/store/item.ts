import { Node, GenericNode } from "@airday/list";
import { GenericComponent } from "../item/item";
import { v, compile } from "suretype";
import type { TypeOf } from "suretype";
import { createUniqueId } from "solid-js";
import { AirWorkspace } from "./main";
import { Debouncer } from "./utils";

const GenericItemSchema = v.object({
  id: v.string(),
  content: v.string(),
  tsDone: v.any(), // TODO: Validate date
});

type GenericItemSchema = TypeOf<typeof GenericItemSchema> & GenericNode<any>;

const justCheckedDebouncer = new Debouncer(1500);

export class GenericItem extends Node {
  id: string;
  type = "generic";
  allowChildren = true;
  tsCreated?: Date;
  tsDone?: Date | null;
  sticker: string | null = null;
  content?: string;
  component = GenericComponent;
  workspace: AirWorkspace;
  justChecked = false;
  justCheckedRef?: () => void;

  static validate = compile(GenericItemSchema, { simple: true });
  constructor(props: GenericItemSchema, workspace: AirWorkspace) {
    super(props);
    this.id = props.id || createUniqueId();
    this.content = props.content;
    this.tsDone = props.tsDone;
    this.sticker = props.sticker;
    this.workspace = workspace;
  }
  serialise() {
    return {
      id: this.id,
      content: this.content,
      tsDone: this.tsDone,
      justChecked: this.justChecked,
      sticker: this.sticker,
    };
  }
  updateContent(newText: string) {
    this.content = newText;
    this.triggerUpdate();
    this.workspace.itemStore.update(this.id, { content: newText });
  }
  updateSticker(sticker: string) {
    this.sticker = sticker || null;
    this.triggerUpdate();
    this.workspace.itemStore.update(this.id, { sticker });
  }
  // If toggling off, this should stay in its parent list for 2 seconds but grey before disappearing
  // deleting from memory list & moving to done memory list (having 2 items simultaneously may be confusing)
  // the state update, however, should take place immediately
  // because of the specificity of the transaction, it's better we create actions with specific instructions
  // at the place of construction
  // if it occurs from the doneList, the interaction is much simpler
  async toggleComplete(historical = false) {
    if (!this.tsDone) {
      this.tsDone = new Date();
      const updatedItem = await this.workspace.itemStore.check(
        this.id,
        this.tsDone,
      );
      if (!historical) {
        this.justChecked = true;
        this.justCheckedRef = justCheckedDebouncer.add(() => {
          this.workspace.itemStore.queue.enqueue({
            type: "check",
            item: updatedItem,
          });
        });
      }
    } else {
      this.tsDone = null;
      const updatedItem = await this.workspace.itemStore.uncheck(this.id);
      this.justChecked = false;
      this.workspace.itemStore.queue.enqueue({
        type: "check",
        item: updatedItem,
      });
      justCheckedDebouncer.remove(this.justCheckedRef);
    }
    this.triggerUpdate();
  }
}

export function itemLoader(workspace: AirWorkspace) {
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
