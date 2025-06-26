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
      // TODO: We should test if the update succeeded and only add it to update object if so
      this.text.merge(fields.text);
      updatePayloads.push(["text", fields.text]); // TODO Something like this
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
