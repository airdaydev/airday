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

class ItemAttributesCodec {
  keyMap = ITEM_KEY_MAP;
  // takes name translates to number
  // takes number translates to name
  // runs validation in... both directions?
}

export class AirdayItem {
  attributes = new ItemAttributesCodec();
  updateText(text: string) {
    const newText = new LWWRegister({
      data: text,
    });
    this.attributes.merge(0, newText);
  }
}

// getAttr(name: N): RegisterMap<K>[N] | undefined {
//   return this.values[name] as RegisterMap<K>[N] | undefined;
// }
// setAttr<N extends keyof K & keyof RegisterMap<K>>(
//   name: N,
//   v: AssociatedValue<K, N>,
// ) {
//   this.values[name] = v;
//   this.dirty.add(name);
// }
