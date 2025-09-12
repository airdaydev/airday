import { LWWRegister } from "../crdt/lww";
import {
  AttributeSet,
  SyncObject,
  SyncObjectParams,
  RegisterMap,
  KeyMap,
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

class ItemAttributes extends AttributeSet<typeof ITEM_KEY_MAP> {
  keyMap = ITEM_KEY_MAP;
}

export class AirdayItem {
  attributes = new ItemAttributes();
  updateText(text: string) {
    const newText = new LWWRegister({
      data: text,
    });
    this.attributes.merge(0, newText);
  }
}
