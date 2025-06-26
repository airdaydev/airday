import type { LWWRegister } from "../client/lww";

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
  toJSON() {
    return {
      id: this.id,
      text: this.text.toJSON(),
    };
  }
}
