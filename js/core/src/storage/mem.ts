// Memory storage for items (or all resources?)
import { AirdayContainer, AirdayItem } from "../sync/model";

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

// Fulfil example: Remote application of moving from one list to another
// Goal: Ensure the item is removed from one list & moved into another!
// Is this possible without going through every single list!?

type Patch =
  | { kind: "container/upsert"; container: Container[] }
  | { kind: "container/remove"; ids: ContainerId[] }
  | { kind: "items/upsert"; items: Item[] }
  | { kind: "items/remove"; ids: ItemId[] }
  // Optional counters so UI can omit heavy data
  | { kind: "counters"; listId: ContainerId; completedCount: number };

class MemStorage {
  items: Map<string, AirdayItem> = new Map();
  constructor() {}
  subscribe() {}
}

class SolidAdapterExample {
  items: Map<string, AirdayItem> = new Map(); // reactive
  containers: Map<string, AirdayContainer> = new Map(); // reactive
}
