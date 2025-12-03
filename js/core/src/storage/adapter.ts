import { Uuidv4 } from "../common/uuid";
import { SyncObject } from "../sync/sync-object";
import { SyncOp } from "../sync/sync-op";

export function dbName(userId: Uuidv4) {
  return `user_${userId.toHex()}`;
}

// Generic persistence layer
export abstract class StorageAdapter {
  abstract connect(userId: Uuidv4): Promise<void>;
  abstract addOp(op: SyncOp, object: SyncObject): Promise<void>;
  abstract updateObject(object: SyncObject): Promise<void>;
  abstract getByLibrary(libraryId: Uuidv4): Promise<any[]>;
  abstract getOutboxOp(id: Uuidv4): Promise<SyncOp>;
  abstract getSyncObject(id: Uuidv4): Promise<SyncObject | undefined>;
  abstract deleteOutboxOp(id: Uuidv4): Promise<void>;
  abstract deleteSyncObject(hexIds: Uuidv4[]): Promise<void>;
  abstract clear(): Promise<void>;
}
