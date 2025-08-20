// Memory storage for items (or all resources?)
import { Uuidv4 } from "../common/uuid";
import { AirdayCore } from "../core";
import { AirdayContainer, AirdayItem } from "../sync/model";
import { AirdayIDB } from "./idb";

// Core types (no Solid imports)
type ContainerId = string;
type ItemId = string;

// TODO: These could just be the serialised versions... or play dangerous and use true references?
type Container = { id: ContainerId; name: string; archived?: boolean };
type Item = {
  id: ItemId;
  listId: ContainerId;
  title: string;
  completed?: boolean;
};

// Fulfill example: Remote application of moving from one list to another
// Goal: Ensure the item is removed from one list & moved into another!
// Is this possible without going through every single list!?

type Patch =
  | { kind: "container/upsert"; container: Container[] }
  | { kind: "container/remove"; ids: ContainerId[] }
  | { kind: "items/upsert"; items: Item[] }
  | { kind: "items/remove"; ids: ItemId[] }
  // Optional counters so UI can omit heavy data
  | { kind: "counters"; listId: ContainerId; completedCount: number };

// TODO: Boot cold items
export class AirdayStorage {
  core: AirdayCore;
  idb = new AirdayIDB();
  items: Map<string, AirdayItem> = new Map(); // hex-id-backed index
  constructor(core: AirdayCore) {
    this.core = core;
  }
  upsertItems(items: AirdayItem[]) {
    items.map((item) => {
      this.items.set(item.id.toHex(), item);
    });
    // TODO: Trigger upsert
  }
  removeItems(ids: Uuidv4[]) {
    ids.forEach((id) => this.items.delete(id.toHex()));
    // TODO: trigger remove
  }
  // TODO: Trigger patch?
  subscribe() {
    // Ensure this happens in batches
  }
  getById(id: Uuidv4) {
    return this.items.get(id.toHex());
  }
}
