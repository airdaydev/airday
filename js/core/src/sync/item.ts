import { globalTSProducer, LWWRegister } from "../crdt/lww";
import { SyncObject, SyncObjectParams } from "./model";

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

// export const itemModel = new AttributeCodec(SyncObjectType.ITEM, "item");
// itemModel.addAttributes([
//   {
//     fieldId: ItemFieldId.ITEM_TEXT,
//     name: "text",
//     type: AttributeType.STRING,
//   },
// ]);

// TODO: Move merge concerns to sync object
export class AirdayItem extends SyncObject {
  readonly objectType = ITEM;
  attributes: AirdayItemAttributes; // TODO: Consider a prototype for SyncObject
  constructor(params: AirdayItemConstructorOpts) {
    super(params);
    this.attributes = params.attributes;
  }
  merge(other: AirdayItem, local: boolean) {
    const otherAttrs = other.attributes;
    const keys = (
      Object.keys(otherAttrs) as Array<keyof AirdayItemAttributes>
    ).map((key) => {
      if (otherAttrs[key]) {
        if (!this.attributes[key]) {
          this.attributes[key] = otherAttrs[key];
        } else {
          const result = this.attributes[key].merge(otherAttrs[key]);
          // Local change gets overruled
          if (local === false && result.source === "right") {
            this.dirtyAttrs.delete(key);
          }
          this.attributes[key] = result.register;
        }
      }
      return key;
    });
    if (local) {
      // Local change gets added to dirty register
      keys.map((key) => this.dirtyAttrs.add(key));
      this.lastModified = globalTSProducer.timestamp().utc;
    }
  }
}
