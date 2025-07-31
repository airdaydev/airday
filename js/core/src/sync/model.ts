import {
  globalTSProducer,
  LWWRegister,
  LWWRegisterString,
  LWWSerialiseSchema,
} from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";

export interface AirdayItemAttributes {
  text?: LWWRegister<string>;
}

export interface AirdayItemConstructorOpts {
  // Immutable
  id?: Uuidv4;
  libraryId: Uuidv4;
  // LWW attributes
  attributes: AirdayItemAttributes;
  // Client-only
  lastSync?: number | null;
  lastModified?: number | null;
}

const AirdayItemSerialisedSchema = v.object({
  id: v.string().required(),
  libraryId: v.string().required(),
  attributes: v
    .object({
      text: LWWSerialiseSchema,
    })
    .required(),
  lastSync: v.anyOf([v.number().gte(0), v.null()]),
  lastModified: v.anyOf([v.number().gte(0), v.null()]),
});

export type AirdayItemSerialised = TypeOf<typeof AirdayItemSerialisedSchema>;

const ensureSerialisedItem = compile(AirdayItemSerialisedSchema, {
  ensure: true,
});

export class AirdayItem {
  id: Uuidv4;
  libraryId: Uuidv4;
  attributes: AirdayItemAttributes;
  syncStarted: number | null = null; // in flight sync
  lastSync: number | null = null; // Last sync (incl. time of first pull)
  lastModified: number; // Last local modification (incl. time of first pull)
  // TODO: isCreating attribute
  // TODO: Find fields with pending updates
  constructor(params: AirdayItemConstructorOpts) {
    this.id = params.id || new Uuidv4();
    this.libraryId = params.libraryId;
    this.attributes = params.attributes;
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
    return this.lastModified > this.lastSync;
  }
  // TODO: Custom logic MAY be necessary
  merge(attrs: AirdayItemAttributes) {
    (Object.keys(attrs) as Array<keyof AirdayItemAttributes>).map((key) => {
      if (attrs[key]) {
        if (!this.attributes[key]) {
          this.attributes[key] = attrs[key];
        } else {
          const text = this.attributes[key].merge(attrs[key]);
        }
      }
    });
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
      lastSync: typed.lastSync,
      lastModified: typed.lastModified,
    });
  }
}
