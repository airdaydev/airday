import { globalTSProducer } from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";

export interface SyncObjectParams {
  objectType: number;
  id?: Uuidv4;
  libraryId: Uuidv4;
  lastModified?: bigint;
  lastSync?: bigint;
}

enum AttributeType {
  "STRING",
  "BOOL",
  "INT",
  "BIGINT",
}

interface Attribute {
  fieldId: number;
  name: string;
  type: AttributeType;
}

interface AttributeSet {}

class AttributeCodec {
  index = new Map<number, string>();
  namesAttached = false;
  constructor(map: Record<string, number>) {
    this.attachMap(map);
  }
  fromFlatBuffer() {
    // create attribute set
    // loop through fields
    // from id, get name map & type, save to name
    return; // a named, live attribute set
  }
  toFlatBuffer(attributeSet: any) {
    // serialise a named attribute set
  }
  // TODO: LLM generated - right idea but change application
  attachMap(map: Record<string, number>) {
    const descMap: PropertyDescriptorMap = {};
    for (const [name, id] of Object.entries(map)) {
      descMap[name] = {
        configurable: false,
        enumerable: true,
        get: () => {
          const v = this.getById(id);
          if (!v) return null;
          switch (v.t) {
            case T.I64_FB:
              return v.i64;
            case T.F64_FB:
              return v.f64;
            case T.STRING:
              return v.str;
            case T.BYTES:
              return v.bytes;
            case T.BOOL_FB:
              return v.bool;
          }
        },
        set: (val: any) => {
          // You decide typing by registry; here are two examples:
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
        },
      };
    }
    Object.defineProperties(this as any, descMap);
    return this as any; // now has friendly props
  }
}

const item = new AttributeCodec();

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

export class SyncObject {
  readonly objectType: number = -1; // Requires class
  id: Uuidv4;
  libraryId: Uuidv4;
  // Sync state concerns
  syncStarted: bigint | null = null; // Local time of flight sync req
  lastSync: bigint | null = null; // Local time of last sync (incl. time of first pull)
  lastModified: bigint; // Local time of last local modification (incl. time of first pull)
  serverSeq: bigint | null = null; // Last known server seq timestamp (useful for sync diff)
  dirtyAttrs: Set<string> = new Set();
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
    // not yet implemented
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
