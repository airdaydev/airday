import { type IDBPTransaction } from "idb";
import type { MessageWrapper } from "../client/sync";
import type {
  AirdayDBSchema,
  AirdayIDBPDatabase,
  AirdayStoreNames,
} from "./idb";
import type { Message } from "../air-fb";

export type WALTx<T extends AirdayStoreNames[]> = IDBPTransaction<
  AirdayDBSchema,
  ["wal", ...T],
  "readwrite"
>;

export class WAL {
  private idb: AirdayIDBPDatabase | null = null;
  // TODO: Use account
  setDB(idb: AirdayIDBPDatabase) {
    this.idb = idb;
  }
  writeTx<T extends AirdayStoreNames[]>(
    storeNames: T,
    messageWrapper: MessageWrapper,
  ): WALTx<T> {
    const stores: ["wal", ...T] = ["wal", ...storeNames];
    const tx = this.idb!.transaction(stores, "readwrite");
    tx.objectStore("wal").add(messageWrapper);
    return tx;
  }
  async complete(entryId: string): Promise<void> {
    await this.idb!.delete("wal", entryId);
  }
  async getPendingEntries(): Promise<MessageWrapper[]> {
    return this.idb!.getAll("wal");
  }
}
