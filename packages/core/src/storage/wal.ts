import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Action } from "../client/item";
import type { AirdayIDBPDatabase } from "./idb";

export interface WALEntry {
  id: string;
  timestamp: number;
  action: any;
}

function ActionWALEntry(action: Action | Action[]): WALEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    action,
  };
}

export class WAL {
  private db: AirdayIDBPDatabase | null = null;
  // TODO: Use account
  constructor(db: AirdayIDBPDatabase) {
    this.db = db;
  }
  async write(action: Action | Action[]): Promise<WALEntry> {
    const entry: WALEntry = ActionWALEntry(action);
    await this.db!.add("wal", entry);
    return entry;
  }
  async complete(entryId: string): Promise<void> {
    await this.db!.delete("wal", entryId);
  }
  async getPendingEntries(): Promise<WALEntry[]> {
    return this.db!.getAll("wal");
  }
}
