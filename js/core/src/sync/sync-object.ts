import { globalTSProducer, LWWRegister, LWWTimestamp } from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";
import { Builder } from "flatbuffers";
import { AttributeProto, AttributeSetProto, AttrTypeProto } from "../proto";

export type KeyMap = { readonly [k: string]: number };
export type RegisterMap<K extends KeyMap> = {
  [P in keyof K]?: LWWRegister<any>;
};
type IdToName<K extends KeyMap, Id extends K[keyof K]> = {
  [P in keyof K]: K[P] extends Id ? P : never;
}[keyof K];
type AssociatedValue<K extends KeyMap, N extends keyof K> =
  | RegisterMap<K>[N]
  | Exclude<RegisterMap<K>[N], undefined>;

// <K extends KeyMap>

export type NumericAttrMap = { [k: number]: LWWRegister<any> };

// All variants
export class AttributeSet {
  raw: Uint8Array = new Uint8Array(); // TODO: store or naaaah...?
  values: NumericAttrMap = {};
  dirty: Set<string> = new Set(); // Updated locally, but not accepted (str rep of identifier)

  // TODO: Complete implementation
  merge(other: AttributeSet, local: boolean) {
    for (const key in other.values) {
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
      }
    }
  }
  fromFlatBuffer() {
    const as = new AttributeSetProto();
    for (let i = 0; i <= as.attributesLength(); i++) {
      const attr = as.attributes(i);
      if (attr) {
        const fieldId = attr.fieldId();
        try {
          const decodedAttr = this.decodeAttribute(attr);
          this.values[fieldId] = decodedAttr;
        } catch (err) {
          console.warn("error creating item from flatbuffer", err);
        }
      }
    }
    // TODO: Should we make this a static method?
    return;
  }
  private decodeAttribute(attr: AttributeProto) {
    const id = attr.fieldId();
    const type = attr.valueType();
    const rawTimestamp = attr.timestamp();
    if (!rawTimestamp) {
      throw new Error(`No timestamp found while decoding attr!`);
    }
    const timestamp = LWWTimestamp.fromProto(rawTimestamp);
    let data;
    switch (type) {
      case AttrTypeProto.BOOL: {
        data = attr.string;
        break;
      }
      case AttrTypeProto.STRING: {
        data = attr.bool;
        break;
      }
      case AttrTypeProto.I64: {
        data = attr.f64Fb;
        break;
      }
      case AttrTypeProto.F64: {
        data = attr.i64Fb;
        break;
      }
      case AttrTypeProto.BYTES: {
        data = attr.i64Fb;
        break;
      }
      default: {
        throw new Error(`Unknown type - cannot decode`);
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
    if (!this.dirty.size) {
      // TODO: Figure out usage patterns
      throw new Error("no dirty attributes to send");
    }
    for (let key of Object.keys(this.values)) {
      if (dirtyOnly && !this.dirty.has(key)) {
        // Skip non-dirty key
        continue;
      }
      // TODO: careful translating direct
      const offset = this.encodeAttribute(builder, Number(key));
    }
  }
  encodeAttribute(builder: Builder, fieldId: number) {
    const field = this.values[fieldId];
    if (!field) {
      console.warn(`Could not find field ${fieldId} to encode`);
      return false;
    }
    console.log(field.data);
    let dataOffset;
    // TODO: Better typing
    if (typeof field.data === "string") {
      // TODO: If non-scalar type
      dataOffset = builder.createString(field.data);
    }
    AttributeProto.startAttributeProto(builder);
    AttributeProto.addFieldId(builder, fieldId);
    AttributeProto.addValueType(builder, AttrTypeProto.STRING);
    AttributeProto.addTimestamp(
      builder,
      field?.timestamp.addToFlatBuffer(builder),
    );
    if (dataOffset) {
      // TODO: Correct type
      AttributeProto.addString(builder, dataOffset);
    }
    return AttributeProto.endAttributeProto(builder);
  }
  // setVal(val) {
  //   if (typeof val === "string") {
  //     this.putById(id, { t: T.STRING, str: val, ts: nowLww() });
  //   } else if (typeof val === "boolean") {
  //     this.putById(id, { t: T.BOOL_FB, bool: val, ts: nowLww() });
  //   } else if (typeof val === "bigint") {
  //     this.putById(id, { t: T.I64_FB, i64: val, ts: nowLww() });
  //   } else if (typeof val === "number") {
  //     this.putById(id, { t: T.F64_FB, f64: val, ts: nowLww() });
  //   } else if (val instanceof Uint8Array) {
  //     this.putById(id, { t: T.BYTES, bytes: val, ts: nowLww() });
  //   } else {
  //     throw new Error(`Unsupported value for ${name}`);
  //   }
  // }
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

export class SyncObject {
  readonly objectType: number;
  id: Uuidv4;
  libraryId: Uuidv4;
  // Sync state concerns
  syncStarted: bigint | null = null; // Local time of flight sync req
  lastSync: bigint | null = null; // Local time of last sync (incl. time of first pull)
  lastModified: bigint; // Local time of last local modification (incl. time of first pull)
  serverSeq: bigint | null = null; // Last known server seq timestamp (useful for sync diff)
  attributes: AttributeSet = new AttributeSet();
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
  // Local = do not add to change register
  merge(other: SyncObject<A>, local: boolean) {
    // if (local) {
    //   // Local change gets added to dirty register
    //   keys.map((key) => this.dirtyAttrs.add(key));
    //   this.lastModified = globalTSProducer.timestamp().utc;
    // }
  }
  // Merges & flags local changes
  applyLocal(attrs: SyncObject<A>) {
    // TODO: Type check here?
    this.merge(attrs, true);
  }
  applyRemote(attrs: SyncObject<A>) {
    this.merge(attrs, false);
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
}
