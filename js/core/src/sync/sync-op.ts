import { Builder } from "flatbuffers";
import { Uuidv4 } from "../common/uuid";
import { AttributeSetProto, OpKind, SyncOpProto, UuidProto } from "../proto";
import { NumericAttrMap, SyncObject } from "./sync-object";
import { v, compile } from "suretype";
import { serialiseAttr } from "./fb";

export interface SerialisedSyncOp {
  id: Uuidv4;
  opKind: OpKind;
  payload?: Uint8Array;
  libraryId: Uuidv4;
  objId: Uuidv4;
  objKind: number;
}

export interface SyncOpParams {
  id?: Uuidv4;
  opKind: OpKind;
  payload?: Uint8Array;
  patch?: NumericAttrMap;
  libraryId: Uuidv4;
  objId: Uuidv4;
  objKind: number;
}

const serialisedSyncOpSchema = v.object({
  id: v.any().required(),
  opKind: v
    .number()
    .enum(OpKind.PATCH, OpKind.DELETE, OpKind.SNAPSHOT)
    .required(),
  payload: v.any().required(),
  libraryId: v.any().required(),
  objId: v.any().required(),
  objKind: v.number().required(),
});

const ensureSyncOpAJVPass = compile(serialisedSyncOpSchema, { ensure: true });

function validateSerialisedSyncOp(raw: any): SyncOpParams {
  const validated = ensureSyncOpAJVPass(raw);
  return {
    id: Uuidv4.fromUint8Array(validated.id),
    opKind: validated.opKind,
    payload: validated.payload, // TODO: Validate
    libraryId: Uuidv4.fromUint8Array(validated.libraryId),
    objId: Uuidv4.fromUint8Array(validated.objId),
    objKind: validated.opKind,
  };
}

export class SyncOp {
  id: Uuidv4;
  opKind: OpKind;
  libraryId: Uuidv4;
  objId: Uuidv4;
  objKind: number;
  patch?: NumericAttrMap;
  payload?: Uint8Array;
  constructor(params: SyncOpParams) {
    this.id = new Uuidv4();
    this.opKind = params.opKind;
    this.libraryId = params.libraryId;
    this.objId = params.objId;
    this.objKind = params.objKind;
    this.payload = params.payload;
    this.patch = params.patch;
  }
  toIdb(): SerialisedSyncOp {
    return {
      id: this.id,
      opKind: this.opKind,
      libraryId: this.libraryId,
      objId: this.id,
      objKind: this.objKind,
      payload: this.payload,
    };
  }
  static fromIdb(raw: any): SyncOp {
    // Validate the raw data from IndexedDB
    const validated = validateSerialisedSyncOp(raw);

    // Convert Uint8Arrays to Uuidv4 instances
    return new SyncOp({
      id:
        validated.id instanceof Uuidv4
          ? validated.id
          : new Uuidv4(validated.id),
      opKind: validated.opKind,
      libraryId:
        validated.libraryId instanceof Uuidv4
          ? validated.libraryId
          : new Uuidv4(validated.libraryId),
      objId:
        validated.objId instanceof Uuidv4
          ? validated.objId
          : new Uuidv4(validated.objId),
      objKind: validated.objKind,
      payload: validated.payload,
    });
  }
  serialisePatch() {
    if (!this.patch || !this.patch.size) {
      throw new Error("No patch found on op");
    }
    if (!this.patch.size) {
      throw new Error("building payload with size = 0");
    }
    const builder = new Builder();
    const attributes: number[] = [];
    for (const key of Object.keys(this.patch)) {
      const offset = serialiseAttr(builder, this.patch, Number(key));
      if (offset) {
        attributes.push(offset);
      }
    }
    const attributesOffset = AttributeSetProto.createAttributesVector(
      builder,
      attributes,
    );
    const offset = AttributeSetProto.createAttributeSetProto(
      builder,
      attributesOffset,
    );
    builder.finish(offset);
    return builder.asUint8Array();
  }
  addToFlatBuffer(builder: Builder) {
    let vectorOffset;
    if (this.payload) {
      vectorOffset = builder.createByteVector(this.payload);
    }
    SyncOpProto.startSyncOpProto(builder);
    SyncOpProto.addProtoVersion(builder, 1);
    SyncOpProto.addOpId(
      builder,
      UuidProto.createUuidProto(builder, this.id.toUUIDProto()),
    );
    SyncOpProto.addOpKind(builder, this.opKind);
    SyncOpProto.addObjKind(builder, this.objKind);
    SyncOpProto.addObjId(
      builder,
      UuidProto.createUuidProto(builder, this.id.toUUIDProto()),
    );
    SyncOpProto.addLibraryId(
      builder,
      UuidProto.createUuidProto(builder, this.libraryId.toUUIDProto()),
    );
    // TODO: e2ee payload
    if (vectorOffset) {
      SyncOpProto.addPayload(builder, vectorOffset);
    }
    const offset = SyncOpProto.endSyncOpProto(builder);
    return offset;
  }
}
