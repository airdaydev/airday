import { LWWRegister } from "../crdt/lww";
import {
  AttributeSet,
  SyncObject,
  SyncObjectParams,
  RegisterMap,
  KeyMap,
  Change,
} from "./sync-object";

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

export class AirdayItem {
  syncObject: SyncObject;
  // TODO: create signal
  constructor(syncObject: SyncObject) {
    this.syncObject = syncObject;
    this.syncObject.attributes.subscribe(this.react);
  }
  react(change: Change) {
    // TODO: Map each change to update correct signal
  }
  updateText(text: string) {
    // TODO: The merge needs to be monotonic from the last seen timestamp, not just the last generated
    const newText = new LWWRegister({
      data: text,
    });
    // this.attributes.merge(0, newText);
  }
}
