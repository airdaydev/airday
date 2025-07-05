import { v4, parse } from "uuid";
import type { LWW, LWWRegister } from "../crdt/lww";
import { Builder } from "flatbuffers";
import { AddMessage, Item, Message, RootMessage } from "../air-fb";

interface AirdayItemParams {
  id: string;
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
  id: string;
  text: LWWRegister<string>;
  constructor(params: AirdayItemParams) {
    this.id = params.id || v4();
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
  toFlatBuffer(builder: Builder) {
    Item.startItem(builder);
    let idOffset = Item.createIdVector(builder, parse(this.id));
    Item.addId(builder, idOffset);
    const offset = Item.endItem(builder);
    return offset;
  }
}
