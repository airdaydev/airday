import { LWWRegisterString } from "../crdt/lww";
import { Uuidv4 } from "../common";

export interface AirdayItemAttributes {
  text?: LWWRegisterString;
}

enum SyncState {
  synced = 0, // Server has acknowledged sync
  dirty = 1, // Local modifications not synced
  syncing = 2, // Pending sync (on deserialisation, make dirty)
}

export interface AirdayItemSerialised {
  // Immutable
  id: string;
  workspaceId: string;
  // LWW attributes (Serialise!)
  attributes: AirdayItemAttributes;
  // Client-only
  syncState: SyncState;
}

export interface AirdayItemConstructorOpts {
  // Immutable
  id: Uuidv4;
  workspaceId: Uuidv4;
  // LWW attributes
  attributes: AirdayItemAttributes;
  // Client-only
  syncState: SyncState;
}

export class AirdayItem {
  id: Uuidv4;
  workspaceId: Uuidv4;
  text?: LWWRegisterString;
  attributes: AirdayItemAttributes;
  syncState = SyncState.synced;
  // TODO: isCreating attribute
  // TODO: Find fields with pending updates
  constructor(params: AirdayItemConstructorOpts) {
    this.id = params.id || new Uuidv4();
    this.workspaceId = params.workspaceId;
    this.attributes = params.attributes;
  }
  // TODO: Custom logic MAY be necessary
  merge(fields: AirdayItemAttributes) {
    (Object.keys(fields) as Array<keyof AirdayItemAttributes>).map((key) => {
      if (fields[key]) {
        if (!this[key]) {
          this[key] = fields[key];
        } else {
          const text = this[key].merge(fields[key]);
        }
      }
    });
  }
  toJSON() {
    // TODO: Clean up id requirement
    let obj: AirdayItemSerialised = {
      id: this.id.toString(),
      workspaceId: this.id.toString(),
      attributes: {}, // TODO: Attributes!
      syncState: this.syncState,
    };
    return obj;
  }
}
