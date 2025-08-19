// Memory storage for items (or all resources?)
import { AirdayItem } from "../sync/model";

// Core types (no Solid imports)
type ListId = string;
type ItemId = string;

type List = { id: ListId; name: string; archived?: boolean /* ... */ };
type Item = {
  id: ItemId;
  listId: ListId;
  title: string;
  completed?: boolean /* ... */;
};

type Patch =
  | { kind: "container/upsert"; container: List[] }
  | { kind: "container/remove"; ids: ListId[] }
  | { kind: "container/field"; id: ListId; changes: Partial<List> }
  | { kind: "items/upsert"; items: Item[] }
  | { kind: "items/remove"; ids: ItemId[] }
  | { kind: "items/field"; id: ItemId; changes: Partial<Item> }
  // Membership & ordering (coalesced per txn)
  | {
      kind: "index/add";
      listId: ListId;
      itemIds: ItemId[];
      beforeId?: ItemId | null;
    }
  | { kind: "index/remove"; listId: ListId; itemIds: ItemId[] }
  | {
      kind: "index/move";
      listId: ListId;
      itemId: ItemId;
      beforeId?: ItemId | null;
    }
  | { kind: "index/reset"; listId: ListId; itemIds: ItemId[] }
  // Optional counters so UI can omit heavy data
  | { kind: "counters"; listId: ListId; completedCount: number };

class MemStorage {
  items: Map<string, AirdayItem> = new Map();
  constructor() {}
  subscribe() {}
}
