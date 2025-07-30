// TODO: Write test

import { parse, stringify, v4 } from "uuid";

export class Uuidv4 extends Uint8Array {
  constructor(props: Uint8Array = parse(v4())) {
    super(props);
  }
  toString() {
    return stringify(this);
  }
  static fromString(uuidString: string) {
    return new Uuidv4(parse(uuidString));
  }
  static fromFBVector(id: (index: number) => number | null) {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      let byte = id(i);
      if (byte === null)
        throw new Error("UUID failed to parse from flatbuffer");
      bytes[i] = byte;
    }
    return bytes;
  }
  // TODO: Seems like you could just pass it in directly? just chops off length?
  // Not currently used as we have to used vector fb representations atm
  static fromFBFixed(id: Uint8Array) {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      let byte = id[i];
      if (byte === null)
        throw new Error("UUID failed to parse from flatbuffer");
      bytes[i] = byte;
    }
    return bytes;
  }
  static fromHex(str: string) {
    return new Uuidv4(Uint8Array.fromHex(str));
  }
}
