import { globalTSProducer, LWWRegister, LWWTimestamp } from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";
import { Builder, ByteBuffer } from "flatbuffers";
import { AttributeProto, AttributeSetProto, AttrTypeProto } from "../proto";

export type KeyMap = { readonly [k: string]: number };
export type RegisterMap<K extends KeyMap> = {
  [P in keyof K]?: LWWRegister<any>;
};

// n.b. keys arrive as ints but internally we use strs to avoid constant type changes
export type NumericAttrMap = { [k: string]: LWWRegister<any> };
export type Change = [id: string, reg?: LWWRegister<any>];
type Listener = (reg: Change) => void;

// All variants
export class SyncObject {
  readonly objectType: number;
  id: Uuidv4;
  libraryId: Uuidv4;
  // Sync state concerns
  syncStarted: bigint | null = null; // Local time of flight sync req
  lastSync: bigint | null = null; // Local time of last sync (incl. time of first pull)
  lastModified: bigint; // Local time of last local modification (incl. time of first pull)
  serverSeq: bigint | null = null; // Last known server seq timestamp (useful for sync diff)
  //
  raw: Uint8Array = new Uint8Array(); // TODO: store or naaaah...?
  values: NumericAttrMap = {};
  dirty: Set<string> = new Set(); // Updated locally, but not accepted (str rep of identifier)
  // Reactivity
  private subs = new Set<Listener>();
  private pending = new Map<string, LWWRegister<any> | undefined>();
  private scheduled = false;

  constructor(params: SyncObjectParams) {
    this.objectType = params.objectType;
    this.id = params.id || new Uuidv4();
    this.libraryId = params.libraryId;
    if (params.lastModified) {
      this.lastModified = params.lastModified;
    } else {
      this.lastModified = globalTSProducer.timestamp().utc;
    }
    if (params.lastSync) {
      this.lastSync = params.lastSync;
    }
  }

  subscribe(cb: Listener): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private notify(val: any) {
    for (const cb of this.subs.values()) {
      cb(val);
    }
  }

  private markChanged(id: string, reg?: LWWRegister<any>) {
    this.pending.set(id, reg);
    if (!this.scheduled) {
      this.scheduled = true;
      // TODO: Point of microtask is to batch changes made in same code path
      queueMicrotask(() => {
        this.scheduled = false;
        if (!this.pending.size) return;
        const out: Change[] = [];
        for (const [id, reg] of this.pending) {
          out.push([id, reg]);
        }
        this.pending.clear();
        this.notify(out);
      });
    }
  }
  startSync() {
    this.syncStarted = globalTSProducer.timestamp().utc;
  }
  endSync() {
    this.lastSync = this.syncStarted;
    this.syncStarted = null;
  }
  isSynced() {
    if (!this.lastSync) return false;
    return this.lastSync >= this.lastModified;
  }
  toDB(): DBSyncObject {
    // Create attribute flatbuffer blob
    const attributes = {};
    return {
      id: this.id.toHex(),
      objectType: this.objectType,
      libraryId: this.libraryId.toHex(),
      serverSeq: this.serverSeq,
      lastSync: this.lastSync,
      lastModified: this.lastModified,
      attributes,
    };
  }

  // TODO: Complete implementation
  merge(other: SyncObject, local: boolean) {
    for (const key of Object.keys(other.values)) {
      const curVal = this.values[key];
      if (!curVal) {
        this.values[key] = curVal;
      } else {
        const otherVal = other.values[key];
        if (!otherVal) throw new Error("val is set but not populated");
        const result = curVal.merge(otherVal as any); // TODO: do we want to validate type on every merge/extraction?
        if (result.source === "right" && local === false) {
          this.dirty.delete(key);
        }
        this.values[key] = result.register;
        this.markChanged(key, result.register); // UI reaction
      }
    }
  }
  mergePatch(map: NumericAttrMap, local: boolean) {
    for (const key of Object.keys(map)) {
      const curVal = this.values[key];
      if (!curVal) {
        this.values[key] = curVal;
      } else {
        const otherVal = map[key];
        if (!otherVal) throw new Error("val is set but not populated");
        const result = curVal.merge(otherVal as any); // TODO: do we want to validate type on every merge/extraction?
        if (result.source === "right" && local === false) {
          this.dirty.delete(key);
        }
        this.values[key] = result.register;
        this.markChanged(key, result.register);
      }
    }
  }
  parseAttrSet(buffer: Uint8Array) {
    const bb = new ByteBuffer(buffer);
    const attrSet = AttributeSetProto.getRootAsAttributeSetProto(bb);
    for (let i = 0; i < attrSet.attributesLength(); i++) {
      const attr = attrSet.attributes(i);
      if (attr) {
        const lww = this.deserialiseAttr(attr);
        this.values[attr.fieldId()] = lww;
      }
    }
  }

  static fromFlatBuffer(buffer: Uint8Array) {}
  // TODO: Attributes only?
  // fromFlatBuffer() {
  //   const as = new AttributeSetProto();
  //   for (let i = 0; i <= as.attributesLength(); i++) {
  //     const attr = as.attributes(i);
  //     if (attr) {
  //       const fieldId = attr.fieldId();
  //       try {
  //         const deserialised = this.deserialiseAttr(attr);
  //         this.values[fieldId] = deserialised;
  //       } catch (err) {
  //         console.warn("error creating item from flatbuffer", err);
  //       }
  //     }
  //   }
  //   // TODO: Should we make this a static method?
  //   return;
  // }
  private deserialiseAttr(attr: AttributeProto) {
    const type = attr.valueType();
    const rawTimestamp = attr.timestamp();
    if (!rawTimestamp) {
      throw new Error(`No timestamp found while deserialising attr!`);
    }
    const timestamp = LWWTimestamp.fromProto(rawTimestamp);
    let data;
    switch (type) {
      case AttrTypeProto.BOOL: {
        data = attr.bool();
        break;
      }
      case AttrTypeProto.STRING: {
        data = attr.string();
        break;
      }
      case AttrTypeProto.F64: {
        data = attr.f64Fb();
        break;
      }
      case AttrTypeProto.I64: {
        data = attr.i64Fb();
        break;
      }
      case AttrTypeProto.BYTES: {
        // TODO: Bytes is currently obviously not working
        data = attr.bytes(0);
        break;
      }
      default: {
        throw new Error(`Unknown type - cannot deserialise`);
      }
    }
    return new LWWRegister({
      data,
      timestamp,
    });
  }
  // @dirtyOnly: Serialise only dirty attributes to flatbuffer (for efficient sync)
  toFlatBuffer(builder: Builder, dirtyOnly: boolean = false) {
    const attributes: number[] = [];
    if (dirtyOnly && !this.dirty.size) {
      // TODO: Figure out usage patterns to determine if an error is appropriate
      throw new Error("no dirty attributes to send");
    }
    for (let key of Object.keys(this.values)) {
      if (dirtyOnly && !this.dirty.has(key)) {
        // Skip non-dirty key
        continue;
      }
      // TODO: careful translating direct
      const offset = this.serialiseAttr(builder, Number(key));
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
    return offset;
  }
  serialiseAttr(builder: Builder, fieldId: number) {
    const field = this.values[fieldId];
    if (!field) {
      console.warn(`Could not find field ${fieldId} to serialise`);
      return false;
    }
    let strOffset;
    let valueType;
    switch (typeof field.data) {
      case "string": {
        valueType = AttrTypeProto.STRING;
        strOffset = builder.createString(field.data);
        break;
      }
      case "boolean": {
        valueType = AttrTypeProto.BOOL;
        break;
      }
      case "number": {
        valueType = AttrTypeProto.F64;
        break;
      }
      default: {
        console.warn(`unable to deserialise type=${typeof field.data}`);
        return false;
      }
    }
    AttributeProto.startAttributeProto(builder);
    AttributeProto.addFieldId(builder, fieldId);
    AttributeProto.addValueType(builder, valueType);
    AttributeProto.addTimestamp(
      builder,
      field.timestamp.addToFlatBuffer(builder),
    );
    if (strOffset) {
      AttributeProto.addString(builder, strOffset);
    }
    // TODO: Double type check...?
    if (valueType === AttrTypeProto.F64 && typeof field.data === "number") {
      AttributeProto.addF64Fb(builder, field.data);
    }
    if (valueType === AttrTypeProto.BOOL && typeof field.data === "boolean") {
      AttributeProto.addBool(builder, field.data);
    }
    return AttributeProto.endAttributeProto(builder);
  }
}

// TODO: Delete this in favour of custom-built meta and attributes (split)
const DBSyncObjectSchema = v.object({
  id: v.string().required(),
  objectType: v.number().required(),
  libraryId: v.string().required(),
  serverSeq: v.anyOf([v.unknown(), v.null()]),
  lastSync: v.anyOf([v.unknown(), v.null()]),
  lastModified: v.anyOf([v.unknown(), v.null()]),
  attributes: v.any(), // TODO: Blob?
});

export type DBSyncObject = TypeOf<typeof DBSyncObjectSchema>;

export function parseGenericSyncObject(record: any) {
  ensureDBSyncObject(record); // TODO: First check if syncobject is good, then do attributes
  let syncObject = record as DBSyncObject;
  const meta = {
    id: Uuidv4.fromHex(syncObject.id),
    objectType: syncObject.objectType,
    libraryId: Uuidv4.fromHex(syncObject.libraryId),
    lastSync: syncObject.lastSync as bigint, // TODO: or null?
    lastModified: syncObject.lastModified as bigint, // TODO: or null?
    attributes: syncObject.attributes,
  };
  return meta;
}

const ensureDBSyncObject = compile(DBSyncObjectSchema, {
  ensure: true,
});

export interface SyncObjectParams {
  id?: Uuidv4;
  libraryId: Uuidv4;
  lastModified?: bigint;
  lastSync?: bigint;
  objectType: number;
}
