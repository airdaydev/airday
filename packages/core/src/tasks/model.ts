import { v4, parse } from "uuid";
import { TimestampProducer, LWWRegisterString } from "../crdt/lww";

export interface AirdayItemFields {
  id: Uint8Array;
  text: LWWRegisterString;
}

type UpdateFields = Partial<Omit<AirdayItemFields, "id">>;

export class AirdayItem {
  id: Uint8Array;
  text?: LWWRegisterString;
  constructor(params: Partial<AirdayItemFields>) {
    this.id = params.id || parse(v4());
    if (params.text) {
      this.text = params.text;
    }
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
    return {
      id: this.id,
      text: this.text?.toJSON() || "",
    };
  }
}
