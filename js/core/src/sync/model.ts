import { LWWRegisterString } from "../crdt/lww";
import { Uuidv4 } from "../common";

export interface AirdayAttributes {
  text?: LWWRegisterString;
}

export interface AirdayItemFields {
  // Immutable
  id: Uuidv4;
  workspaceId: Uuidv4;
  // LWW attributes
  attributes: AirdayAttributes;
  // Client-only
  dirty: true;
}

export class AirdayItem {
  id: Uuidv4;
  text?: LWWRegisterString;
  constructor(params: AirdayItemFields) {
    this.id = params.id || new Uuidv4();
  }
  // TODO: Custom logic MAY be necessary
  merge(fields: Partial<AirdayAttributes>) {
    (Object.keys(fields) as Array<keyof AirdayAttributes>).map((key) => {
      if (fields[key]) {
        if (!this[key]) {
          this[key] = fields[key];
        } else {
          const text = this[key].merge(fields[key]);
        }
      }
    });
  }
  toJSON() {
    // TODO: Clean up id requirement
    let obj: Partial<SerialisedAirdayItem> = {
      id: this.id.toString(),
    };
    if (this.text) {
      obj.text = this.text.toJSON();
    }
    return obj;
  }
}
