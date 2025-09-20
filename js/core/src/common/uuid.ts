/// <reference path="../types/browser.d.ts" />

import { parse, stringify, v4 } from "uuid";
import { hexToUint8Array, uint8ArrayToHex } from "uint8array-extras";
import { UuidProto } from "../proto";

export type HexUuid = string; // for hash storage

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
  static fromFBProto(id: UuidProto | null) {
    if (!id || !id.bb) {
      throw new Error("UUID failed to parse from flatbuffer");
    }
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      let byte = id.value(i);
      if (byte === null)
        throw new Error("UUID failed to parse from flatbuffer");
      bytes[i] = byte;
    }
    return new Uuidv4(bytes);
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
  toUUIDProto() {
    const result = new Array(16);
    for (let i = 0; i < 16; i++) {
      result[i] = this[i];
    }
    return result;
  }
}
