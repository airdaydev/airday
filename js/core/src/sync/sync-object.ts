import { globalTSProducer, LWWRegister, LWWTimestamp } from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";
import { Builder } from "flatbuffers";
import { AttributeProto, AttributeSetProto, AttrTypeProto } from "../proto";

export interface SyncObjectParams {
  id?: Uuidv4;
  libraryId: Uuidv4;
  lastModified?: bigint;
  lastSync?: bigint;
}

export enum AttrType {
  string,
  boolean,
  number,
  bigint,
}
type AttrSpec<T extends AttrType = AttrType, N extends string = string> = {
  readonly name: N;
  readonly t: T;
};
export type AttributeSchema = Record<number, AttrSpec>;

type FieldIdOf<A extends AttributeSchema> = Extract<keyof A, number>;
type NameOf<A extends AttributeSchema> = {
  [K in keyof A]: A[K] extends { readonly name: infer N extends string }
    ? N
    : never;
}[keyof A];

type TsType<T extends AttrType> = T extends AttrType.string
  ? LWWRegister<string>
  : T extends AttrType.boolean
    ? LWWRegister<boolean>
    : T extends AttrType.number
      ? LWWRegister<number>
      : T extends AttrType.bigint
        ? LWWRegister<bigint>
        : never;

type ValuesById<A extends AttributeSchema> = {
  [F in FieldIdOf<A>]?: A[F] extends { readonly t: infer T extends AttrType }
    ? TsType<T>
    : never;
};

type ByName<A extends AttributeSchema> = {
  [F in keyof A as A[F] extends { readonly name: infer N extends string }
    ? N
    : never]?: A[F] extends { readonly t: infer T extends AttrType }
    ? TsType<T>
    : never;
};

type IdForName<A extends AttributeSchema, N extends NameOf<A>> = {
  [F in keyof A]: A[F] extends { readonly name: N } ? F : never;
}[keyof A] &
  FieldIdOf<A>;

type NameToId<A extends AttributeSchema> = {
  [N in NameOf<A>]: IdForName<A, N>;
};

// Build a *trusted* inverse map directly from the schema.
export function invertSchema<A extends AttributeSchema>(
  schema: A,
): NameToId<A> {
  const m = {} as any;
  for (const id in schema) m[schema[id as any].name] = Number(id);
  return m;
}

export abstract class AttributeSet<A extends AttributeSchema> {
  abstract readonly schema: Readonly<A>;
  abstract readonly invert: Readonly<NameToId<A>>;
  // Underlying LWWRegisters
  private values: ValuesById<A> = {} as any;
  // Name based accessors
  getAttr<N extends NameOf<A>>(name: N): ByName<A>[N] | undefined {
    const id: IdForName<A, N> = this.invert[name];
    return this.values[id] as ByName<A>[N] | undefined;
  }
  setAttr<N extends NameOf<A>>(name: N, v: ByName<A>[N]) {
    const id: IdForName<A, N> = this.invert[name];
    this.values[id] = v as any;
  }
  merge<F extends FieldIdOf<A>>(id: F, data: ValuesById<A>[F]) {
    // TODO: Left vs right so we can skip misses?
    const src = this.values[id] as LWWRegister<any> | undefined;
    if (!data)
      throw new Error("No data found when attempting to merge. Expected LWW.");
    if (!src) {
      this.setById(id, data);
    } else {
      const val = src.merge(data);
      this.setById(id, val.register as any); // TODO: Fix up types
    }
  }
  // TODO: Complete implementation
  mergeMany(other: A) {
    const keys = Object.keys(other).map((key) => {
      if (otherAttrs[key]) {
        if (!this.attributes[key]) {
          this.attributes[key] = otherAttrs[key];
        } else {
          const result = this.attributes[key].merge(otherAttrs[key]);
          // Local change gets overruled
          if (local === false && result.source === "right") {
            this.dirtyAttrs.delete(key);
          }
          this.attributes[key] = result.register;
        }
      }
      return key;
    });
  }
  // id based accessors
  getById<F extends FieldIdOf<A>>(id: F) {
    return this.values[id];
  }
  setById<F extends FieldIdOf<A>>(id: F, v: ValuesById<A>[F]) {
    this.values[id] = v;
  }
  fromFlatBuffer() {
    const as = new AttributeSetProto();
    for (let i = 0; i <= as.attributesLength(); i++) {
      const attr = as.attributes(i);
      if (attr) {
        try {
          // TODO: Correct decoding based on type!
          const lww = this.decodeAttribute(attr);
          const fieldId = attr.fieldId();
          if (Object.hasOwn(this.schema, fieldId)) {
            // TODO: Validate?
            this.setById(fieldId as Extract<keyof A, number>, lww as any);
          }
        } catch (err) {
          console.warn("error creating item from flatbuffer", err);
        }
      }
    }
    return; // a named, live attribute set
  }
  encodeAttribute<F extends FieldIdOf<A>>(builder: Builder, fieldId: F) {
    const field = this.getById(fieldId);
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
  private decodeAttribute(attr: AttributeProto) {
    const id = attr.valueType();
    const schema = this.schema[id];
    const rawTimestamp = attr.timestamp();
    if (!rawTimestamp) {
      throw new Error(`No timestamp found while decoding attr!`);
    }
    const timestamp = LWWTimestamp.fromProto(rawTimestamp);
    if (!schema) throw new Error(`No ${id} on ITEM_SCHEMA`);
    let data;
    switch (schema.t) {
      case AttrType.string: {
        data = attr.string;
        break;
      }
      case AttrType.boolean: {
        data = attr.bool;
        break;
      }
      case AttrType.number: {
        data = attr.f64Fb;
        break;
      }
      case AttrType.bigint: {
        data = attr.i64Fb;
        break;
      }
      default: {
        console.warn("not found");
      }
    }
    return new LWWRegister({
      data,
      timestamp,
    });
  }
  toFlatBuffer(builder: Builder, attributeSet: any) {
    // serialise a named attribute set
  }
  setVal(val) {
    if (typeof val === "string") {
      this.putById(id, { t: T.STRING, str: val, ts: nowLww() });
    } else if (typeof val === "boolean") {
      this.putById(id, { t: T.BOOL_FB, bool: val, ts: nowLww() });
    } else if (typeof val === "bigint") {
      this.putById(id, { t: T.I64_FB, i64: val, ts: nowLww() });
    } else if (typeof val === "number") {
      this.putById(id, { t: T.F64_FB, f64: val, ts: nowLww() });
    } else if (val instanceof Uint8Array) {
      this.putById(id, { t: T.BYTES, bytes: val, ts: nowLww() });
    } else {
      throw new Error(`Unsupported value for ${name}`);
    }
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

export abstract class SyncObject {
  abstract readonly objectType: number;
  id: Uuidv4;
  libraryId: Uuidv4;
  // Sync state concerns
  syncStarted: bigint | null = null; // Local time of flight sync req
  lastSync: bigint | null = null; // Local time of last sync (incl. time of first pull)
  lastModified: bigint; // Local time of last local modification (incl. time of first pull)
  serverSeq: bigint | null = null; // Last known server seq timestamp (useful for sync diff)
  dirtyAttrs: Set<number> = new Set();
  abstract attributes: AttributeSet<any>;
  constructor(params: SyncObjectParams) {
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
  merge(other: SyncObject, local: boolean) {
    // if (local) {
    //   // Local change gets added to dirty register
    //   keys.map((key) => this.dirtyAttrs.add(key));
    //   this.lastModified = globalTSProducer.timestamp().utc;
    // }
  }
  // Merges & flags local changes
  applyLocal(attrs: SyncObject) {
    // TODO: Type check here?
    this.merge(attrs, true);
  }
  applyRemote(attrs: SyncObject) {
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
