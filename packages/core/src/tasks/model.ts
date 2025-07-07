import { v4, parse } from "uuid";
import type { LWW, LWWRegister } from "../crdt/lww";

export interface AirdayItemFields {
  id: Uint8Array;
  text: LWWRegister<string>;
}

export class AirdayItem {
  id: Uint8Array;
  text: LWWRegister<string>;
  constructor(params: AirdayItemFields) {
    this.id = params.id || parse(v4());
    this.text = params.text;
  }
  merge(fields: Partial<Omit<AirdayItemFields, "id">>) {
    // TODO: If a server came back with a greater timestamp...
    const updatePayloads = [];
    if (fields.text) {
      const text = this.text.merge(fields.text);
      if (text !== this.text) {
        // Something like this
        updatePayloads.push(["text", fields.text]);
      }
    }
    return updatePayloads;
  }
  toJSON() {
    return {
      id: this.id,
      text: this.text.toJSON(),
    };
  }
}
