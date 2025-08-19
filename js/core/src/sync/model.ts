import { globalTSProducer, LWWRegister, LWWSerialiseSchema } from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";

export interface SyncObjectParams {
  id: Uuidv4;
  libraryId: Uuidv4;
  lastModified?: bigint;
  lastSync?: bigint;
}

export interface AirdayItemAttributes {
  text?: LWWRegister<string>;
}

export interface AirdayItemConstructorOpts extends SyncObjectParams {
  attributes: AirdayItemAttributes;
}

const AirdayItemSerialisedSchema = v.object({
  id: v.string().required(),
  libraryId: v.string().required(),
  attributes: v
    .object({
      text: LWWSerialiseSchema,
    })
    .required(),
  lastSync: v.anyOf([v.unknown(), v.null()]),
  lastModified: v.anyOf([v.unknown(), v.null()]),
});

export type AirdayItemSerialised = TypeOf<typeof AirdayItemSerialisedSchema>;

const ensureSerialisedItem = compile(AirdayItemSerialisedSchema, {
  ensure: true,
});

export class SyncObject {
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
}

// TODO: Complete item
export class AirdayContainer extends SyncObject {}

// TODO: Move merge concerns to sync object
export class AirdayItem extends SyncObject {
  attributes: AirdayItemAttributes; // TODO: Consider a prototype for SyncObject
  constructor(params: AirdayItemConstructorOpts) {
    super(params);
    this.attributes = params.attributes;
  }
  merge(attrs: AirdayItemAttributes, local: boolean) {
    const keys = (Object.keys(attrs) as Array<keyof AirdayItemAttributes>).map(
      (key) => {
        if (attrs[key]) {
          if (!this.attributes[key]) {
            this.attributes[key] = attrs[key];
          } else {
            const result = this.attributes[key].merge(attrs[key]);
            // Local change gets overruled
            if (local === false && result.source === "right") {
              this.dirtyAttrs.delete(key);
            }
            this.attributes[key] = result.register;
          }
        }
        return key;
      },
    );
    if (local) {
      // Local change gets added to dirty register
      keys.map((key) => this.dirtyAttrs.add(key));
      this.lastModified = globalTSProducer.timestamp().utc;
    }
  }
  // Merges & flags local changes
  applyLocal(attrs: AirdayItemAttributes) {
    this.merge(attrs, true);
  }
  applyRemote(attrs: AirdayItemAttributes) {
    this.merge(attrs, false);
  }
  toJSON() {
    // TODO: Clean up id requirement
    let obj: AirdayItemSerialised = {
      id: this.id.toHex(),
      libraryId: this.libraryId.toHex(),
      attributes: {}, // TODO: Attributes!
      lastSync: this.lastSync,
      lastModified: this.lastModified,
    };
    return obj;
  }
  static fromJSON(json: any) {
    ensureSerialisedItem(json);
    let typed = json as AirdayItemSerialised;
    const attributes: AirdayItemAttributes = {};
    if (typed.attributes.text) {
      attributes.text = LWWRegister.fromJSON(typed.attributes.text);
    }
    return new AirdayItem({
      id: Uuidv4.fromHex(typed.id),
      libraryId: Uuidv4.fromHex(typed.libraryId),
      attributes,
      lastSync: typed.lastSync as bigint,
      lastModified: typed.lastModified as bigint,
    });
  }
}
