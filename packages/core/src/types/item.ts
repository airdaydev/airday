import type { LWW, LWWRegister } from "../client/lww";

interface AirdayItemParams {
  id: string;
  text: LWWRegister<string>;
}

export class AirdayItem {
  id: string;
  text: LWWRegister<string>;
  constructor(params: AirdayItemParams) {
    this.id = params.id;
    this.text = params.text;
  }
  merge(fields: Partial<Omit<AirdayItemParams, "id">>) {
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
