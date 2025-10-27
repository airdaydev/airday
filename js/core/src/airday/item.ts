import { Accessor, createSignal, Signal } from "solid-js";
import { LWWRegister } from "../crdt/lww";
import { SyncObject, RegisterMap, KeyMap, Change } from "./sync-object";
import { Uuidv4 } from "../common/uuid";

export const ITEM = 0;

export const ItemFieldId = {
  ITEM_TEXT: 0,
} as const;

export const ITEM_KEY_MAP = {
  text: 0,
  done: 1,
  count: 2,
  bigId: 3,
} as const satisfies KeyMap;

export interface ItemAttrs extends RegisterMap<typeof ITEM_KEY_MAP> {
  text?: LWWRegister<string>;
  done?: LWWRegister<boolean>;
  count?: LWWRegister<number>;
  bigId?: LWWRegister<bigint>;
}

class ItemAttributesCodec {
  keyMap = ITEM_KEY_MAP;
  // takes name translates to number
  // takes number translates to name
  // runs validation in... both directions?
}

// TODO: Pull from core later
// TODO: Could this be based off a consumer class?
// TODO: Where to put setters?
export class AirdayItem {
  private $text: Signal<string>;
  private syncObject: SyncObject;
  // TODO: create signal of all attributes (or... maybe just directly on AirdayItem)
  constructor(syncObject: SyncObject) {
    this.syncObject = syncObject;
    this.syncObject.subscribe(this.react);
    this.$text = createSignal<string>("");
    // Initial population of data?
  }
  get id() {
    return this.syncObject.id;
  }
  get libraryId() {
    return this.syncObject.libraryId;
  }
  get text(): Accessor<string> {
    return this.$text[0];
  }
  // TODO: This may not be necessary with initial population
  private internalValue(id: string) {
    return this.syncObject.values[id]?.data;
  }
  react(change: Change) {
    // TODO: Map each change to update correct signal
    // i.e. decode & react
    const n = Number(change[0]);
    const d = change[1] as any; // TODO: Should we validate type?
    switch (n) {
      case ITEM_KEY_MAP.text: {
        this.$text[1](d);
        break;
      }
    }
  }
  set text(val: string) {
    // TODO: The merge needs to be monotonic from the last seen timestamp, not just the last generated
    // i.e. step 1 = get current timestamp if found
    const patch = new LWWRegister({
      data: val,
    });
    // this.attributes.merge(0, newText);
  }
}
