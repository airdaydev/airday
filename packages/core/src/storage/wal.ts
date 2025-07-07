import { type IDBPTransaction } from "idb";
import type {
  AirdayDBSchema,
  AirdayIDBPDatabase,
  AirdayStoreNames,
} from "./idb";

export type WALTx<T extends AirdayStoreNames[]> = IDBPTransaction<
  AirdayDBSchema,
  ["wal", ...T],
  "readwrite"
>;

export interface AirdayActionWALEntry {
  id: string;
  timestamp: number;
  message: Uint8Array;
}

export function AirdayWALEntry(
  id: string,
  message: Uint8Array,
): AirdayActionWALEntry {
  return {
    timestamp: Date.now(), // useful for replaying
    id: id, // for deletion
    message, // flatbuffer message
  };
}

export class WAL {
  private idb: AirdayIDBPDatabase | null = null;
  // TODO: Use account
  setDB(idb: AirdayIDBPDatabase) {
    this.idb = idb;
  }
  writeTx<T extends AirdayStoreNames[]>(
    storeNames: T,
    walEntry: AirdayActionWALEntry,
  ): WALTx<T> {
    const stores: ["wal", ...T] = ["wal", ...storeNames];
    const tx = this.idb!.transaction(stores, "readwrite");
    tx.objectStore("wal").add(walEntry);
    return tx;
  }
  async complete(entryId: string): Promise<void> {
    await this.idb!.delete("wal", entryId);
  }
  async getPendingEntries(): Promise<AirdayActionWALEntry[]> {
    return this.idb!.getAll("wal");
  }
}
