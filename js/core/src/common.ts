// TODO: Write test

import { parse, stringify, v4 } from "uuid";
import { hexToUint8Array, uint8ArrayToHex } from "uint8array-extras";

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
    return new Uuidv4(bytes);
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
    if (!Uint8Array.fromHex) {
      return new Uuidv4(hexToUint8Array(str));
    }
    return new Uuidv4(Uint8Array.fromHex(str));
  }
  toHex(): string {
    // Direct check for native implementation
    if (Uint8Array.prototype.hasOwnProperty("toHex")) {
      return (Uint8Array.prototype as any).toHex.call(this);
    }
    return uint8ArrayToHex(this);
  }
}
