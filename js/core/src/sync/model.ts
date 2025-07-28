import {
  LWWRegister,
  LWWRegisterString,
  LWWSerialiseSchema,
} from "../crdt/lww";
import { Uuidv4 } from "../common";
import { compile, v, type TypeOf } from "suretype";

export interface AirdayItemAttributes {
  text?: LWWRegister<string>;
}

enum SyncState {
  synced = 0, // Server has acknowledged sync
  dirty = 1, // Local modifications not synced
  syncing = 2, // Pending sync (on deserialisation, make dirty)
}

export interface AirdayItemConstructorOpts {
  // Immutable
  id?: Uuidv4;
  libraryId: Uuidv4;
  // LWW attributes
  attributes: AirdayItemAttributes;
  // Client-only
  syncState?: SyncState;
}

const AirdayItemSerialisedSchema = v.object({
  id: v.string().required(),
  libraryId: v.string().required(),
  attributes: v
    .object({
      text: LWWSerialiseSchema,
    })
    .required(),
  syncState: v
    .number()
    .anyOf([v.number().const(0), v.number().const(1), v.number().const(2)]),
});

export type AirdayItemSerialised = TypeOf<typeof AirdayItemSerialisedSchema>;

const ensureSerialisedItem = compile(AirdayItemSerialisedSchema, {
  ensure: true,
});

export class AirdayItem {
  id: Uuidv4;
  libraryId: Uuidv4;
  attributes: AirdayItemAttributes;
  syncState = SyncState.dirty;
  // TODO: isCreating attribute
  // TODO: Find fields with pending updates
  constructor(params: AirdayItemConstructorOpts) {
    this.id = params.id || new Uuidv4();
    this.libraryId = params.libraryId;
    this.attributes = params.attributes;
    if (
      params.syncState === SyncState.synced ||
      params.syncState === SyncState.dirty
    ) {
      // Do not reserialise "syncing" state
      this.syncState = params.syncState;
    }
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
      id: this.id.toString(),
      libraryId: this.id.toString(),
      attributes: {}, // TODO: Attributes!
      syncState: this.syncState,
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
      id: Uuidv4.fromString(typed.id),
      libraryId: Uuidv4.fromString(typed.libraryId),
      attributes,
      syncState: typed.syncState,
    });
  }
}
