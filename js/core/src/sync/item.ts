import { globalTSProducer, LWWRegister } from "../crdt/lww";
import {
  AttributeSet,
  AttributeSchema,
  AttrType,
  SyncObject,
  SyncObjectParams,
} from "./model";

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

// TODO: Move merge concerns to sync object
export class AirdayItem extends SyncObject {
  readonly objectType = ITEM;
  attributes = new AttributeSet(ITEM_SCHEMA);
}
