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
  objectType = ITEM;
  attributes: AirdayItemAttributes; // TODO: Consider a prototype for SyncObject
  constructor(params: AirdayItemConstructorOpts) {
    super(params);
    this.attributes = params.attributes;
  }
  merge(attrs: AirdayItemAttributes, local: boolean) {
    const keys = (Object.keys(attrs) as Array<keyof AirdayItemAttributes>).map(
      (key) => {
        if (attrs[key]) {
          if (!this.attributes[key]) {
            this.attributes[key] = attrs[key];
          } else {
            const result = this.attributes[key].merge(attrs[key]);
            // Local change gets overruled
            if (local === false && result.source === "right") {
              this.dirtyAttrs.delete(key);
            }
            this.attributes[key] = result.register;
          }
        }
        return key;
      },
    );
    if (local) {
      // Local change gets added to dirty register
      keys.map((key) => this.dirtyAttrs.add(key));
      this.lastModified = globalTSProducer.timestamp().utc;
    }
  }
  // Merges & flags local changes
  applyLocal(attrs: AirdayItemAttributes) {
    this.merge(attrs, true);
  }
  applyRemote(attrs: AirdayItemAttributes) {
    this.merge(attrs, false);
  }
}
