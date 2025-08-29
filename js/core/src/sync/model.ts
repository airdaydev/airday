import { globalTSProducer, LWWRegister, LWWSerialiseSchema } from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";

type SyncObjectType = "item" | "container" | "none";

export interface SyncObjectParams {
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

class AttributeCodec {
  id: number;
  name: string;
  index = new Map<number, string>();
  constructor(id: number, name: string) {
    this.id = id;
    this.name = name;
  }
}

// TODO: Delete this in favour of custom-built meta and attributes (split)
const SyncObjectSerialisedSchema = v.object({
  id: v.string().required(),
  type: v.anyOf([v.string().const("item"), v.string().const("container")]),
  libraryId: v.string().required(),
  attributes: v
    .object({
      text: LWWSerialiseSchema,
    })
    .required(),
  serverSeq: v.anyOf([v.unknown(), v.null()]),
  lastSync: v.anyOf([v.unknown(), v.null()]),
  lastModified: v.anyOf([v.unknown(), v.null()]),
});

export type SerialisedSyncObject = TypeOf<typeof SyncObjectSerialisedSchema>;

const ensureSerialisedSyncObject = compile(SyncObjectSerialisedSchema, {
  ensure: true,
});

export class SyncObject {
  type: SyncObjectType = "none";
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
  toJSON(): SerialisedSyncObject {
    const attributes = {};
    return {
      id: this.id.toHex(),
      libraryId: this.libraryId.toHex(),
      serverSeq: this.serverSeq,
      lastSync: this.lastSync,
      lastModified: this.lastModified,
      attributes,
    };
  }
  static fromJSON(json: any): AirdayItem | AirdayContainer {
    ensureSerialisedSyncObject(json); // TODO: First check if syncobject is good, then do attributes
    let syncObject = json as SerialisedSyncObject;
    const meta = {
      id: Uuidv4.fromHex(syncObject.id),
      libraryId: Uuidv4.fromHex(syncObject.libraryId),
      lastSync: syncObject.lastSync as bigint,
      lastModified: syncObject.lastModified as bigint,
    };
    if (syncObject.type === "item") {
      const attributes: AirdayItemAttributes = {};
      if (syncObject.attributes.text) {
        attributes.text = LWWRegister.fromJSON(syncObject.attributes.text);
      }
      return new AirdayItem({
        ...meta,
        attributes,
      });
    }
    if (syncObject.type === "container") {
      const attributes = {}; // TODO: Get specific attributes for container
      return new AirdayContainer({
        ...meta,
        // attributes,
      });
    }
    // TODO: Handle error (or null return) upstream
    throw new Error("Type not found");
  }
}
