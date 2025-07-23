// TODO: Write test
// TODO: UUID library or build func with v4 only, that creates as bytes before string
export function getUuidBytes(id: Uint8Array) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    let byte = id[i];
    if (byte === null) throw new Error("UUID failed to parse from flatbuffer");
    bytes[i] = byte;
  }
  return bytes;
}

export function getUuidFromFbVec(id: (index: number) => number | null) {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    let byte = id(i);
    if (byte === null) throw new Error("UUID failed to parse from flatbuffer");
    bytes[i] = byte;
  }
  return bytes;
}
