import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from "idb";
import type { Action } from "../client/sync";
import type {
  AirdayDBSchema,
  AirdayIDBPDatabase,
  AirdayStoreNames,
} from "./idb";

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

export type WALTx<T extends AirdayStoreNames[]> = IDBPTransaction<
  AirdayDBSchema,
  ["wal", ...T],
  "readwrite"
>;

export class WAL {
  private idb: AirdayIDBPDatabase | null = null;
  // TODO: Use account
  setDB(idb: AirdayIDBPDatabase) {
    console.log("setting that handle", !!idb);
    this.idb = idb;
  }
  writeTx<T extends AirdayStoreNames[]>(
    storeNames: T,
    action: Action | Action[],
  ): WALTx<T> {
    const stores: ["wal", ...T] = ["wal", ...storeNames];
    const tx = this.idb!.transaction(stores, "readwrite");
    tx.objectStore("wal").add(ActionWALEntry(action));
    return tx;
  }
  async complete(entryId: string): Promise<void> {
    await this.idb!.delete("wal", entryId);
  }
  async getPendingEntries(): Promise<WALEntry[]> {
    return this.idb!.getAll("wal");
  }
}
