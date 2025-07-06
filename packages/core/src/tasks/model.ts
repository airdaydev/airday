import { v4, parse } from "uuid";
import type { LWW, LWWRegister } from "../crdt/lww";
import { Builder } from "flatbuffers";
import { AddMessage, Item, Message, RootMessage } from "../proto";

export interface AirdayItemFields {
  id: Uint8Array;
  text: LWWRegister<string>;
}

// TODO: Test this function
function uuidToBuffer(uuidStr: String) {
  const uuidBuffer = new Uint8Array(16);
  let bufferIndex = 0;

  for (let i = 0; i < uuidStr.length; i++) {
    if (uuidStr[i] === "-") {
      continue; // Skip hyphens
    }
    if (i % 2 === 0) {
      uuidBuffer[bufferIndex] = parseInt(uuidStr.substring(i, 2), 16);
      bufferIndex++;
    }
  }

  return uuidBuffer;
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
