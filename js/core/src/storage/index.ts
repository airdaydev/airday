// Memory storage for items (or all resources?)
import { EventEmitter } from "../common/events";
import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { AirdayContainer, AirdayItem, SyncObject } from "../sync/model";
import { AirdayIDB } from "./idb";

interface StorageEventMap {
  upsert: { objects: SyncObject[] };
  delete: { ids: string[] };
}

// Fulfill example: Remote application of moving from one list to another
// Goal: Ensure the item is removed from one list & moved into another!
// Is this possible without going through every single list!?

// TODO: Boot cold items
export class AirdayStorage {
  core: AirdayCore;
  idb = new AirdayIDB();
  items: Map<string, AirdayItem> = new Map(); // hex-id-backed index
  events = new EventEmitter<StorageEventMap>();
  constructor(core: AirdayCore) {
    this.core = core;
  }
  async upsertItems(items: AirdayItem[]) {
    items.map((item) => {
      this.items.set(item.id.toHex(), item);
    });
    // TODO: Trigger subscription upsert!
    await this.idb.upsert(items);
  }
  async removeItems(ids: Uuidv4[]) {
    const hexes = ids.map((id) => id.toHex());
    hexes.forEach((hex) => this.items.delete(hex));
    await this.idb.delete(hexes);
    // TODO: trigger subscription remove event!
  }
  // TODO: Trigger patch?
  subscribe() {
    // Ensure this happens in batches
  }
  getById(id: Uuidv4) {
    return this.items.get(id.toHex());
  }
}
