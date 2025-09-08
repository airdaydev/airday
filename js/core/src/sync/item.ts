import { LWWRegister } from "../crdt/lww";
import {
  AttributeSet,
  AttributeSchema,
  AttrType,
  SyncObject,
  SyncObjectParams,
  invertSchema,
} from "./sync-object";

export const ITEM = 0;

export const ItemFieldId = {
  ITEM_TEXT: 0,
} as const;

export interface AirdayItemAttributes {
  text?: LWWRegister<string>;
}

export interface AirdayItemConstructorOpts extends SyncObjectParams {
  attributes: AirdayItemAttributes;
}

export const ITEM_SCHEMA = {
  0: { name: "text", t: AttrType.string },
  1: { name: "done", t: AttrType.boolean },
  2: { name: "count", t: AttrType.number },
  3: { name: "bigId", t: AttrType.bigint },
} as const satisfies AttributeSchema;

class ItemAttributes extends AttributeSet<typeof ITEM_SCHEMA> {
  schema = ITEM_SCHEMA;
  invert = invertSchema(ITEM_SCHEMA); // TODO: Profile
}

export class AirdayItem extends SyncObject {
  readonly objectType = ITEM;
  attributes = new ItemAttributes();
  updateText(text: string) {
    const textLWW = new LWWRegister({
      data: "test",
    });
    const attrs = new ItemAttributes();
    attrs.setById(0, textLWW);
  }
}
