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
  // Validates
  static fromUint8Array(bytes: Uint8Array) {
    assertUuidV4Bytes(bytes);
    return new Uuidv4(bytes);
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
  equals(other: Uuidv4): boolean {
    if (this.length !== other.length) return false;
    for (let i = 0; i < 16; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }
}

export type UuidV4Bytes = Uint8Array & { readonly __uuidv4: unique symbol };

export function isUuidV4Bytes(x: unknown): x is UuidV4Bytes {
  if (
    !x ||
    typeof x !== "object" ||
    (x as any).constructor?.name !== "Uint8Array" ||
    (x as any).BYTES_PER_ELEMENT !== 1
  )
    return false;

  const u8 = x as Uint8Array;
  return (
    u8.length === 16 &&
    (u8[6] & 0xf0) === 0x40 && // version 4
    (u8[8] & 0xc0) === 0x80 // RFC4122 variant
  );
}

export function assertUuidV4Bytes(x: unknown): UuidV4Bytes {
  if (!isUuidV4Bytes(x))
    throw new Error(
      "id must be a Uint8Array uuidv4 (16 bytes, v4, RFC4122 variant)",
    );
  return x;
}
