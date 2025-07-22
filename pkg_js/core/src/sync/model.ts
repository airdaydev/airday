import { v4, parse } from "uuid";
import { LWWRegisterString } from "../crdt/lww";
import type { SerialisedAirdayItem } from "./actions";

export interface AirdayItemFields {
  id?: Uint8Array;
  text?: LWWRegisterString;
}

type UpdateFields = Partial<Omit<AirdayItemFields, "id">>;

export class AirdayItem {
  id: Uint8Array;
  text?: LWWRegisterString;
  constructor(params: AirdayItemFields) {
    this.id = params.id || parse(v4());
  }
  // TODO: Custom logic MAY be necessary
  merge(fields: UpdateFields) {
    (Object.keys(fields) as Array<keyof UpdateFields>).map((key) => {
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
