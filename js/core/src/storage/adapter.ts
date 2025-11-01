import { Uuidv4 } from "../common/uuid";
import { SyncObject } from "../sync/sync-object";
import { SyncOp } from "../sync/sync-op";

// Generic persistence layer
export abstract class StorageAdapter {
  abstract connect(): Promise<void>;
  abstract addOp(op: SyncOp, object: SyncObject): Promise<void>;
  abstract updateObject(object: SyncObject): Promise<void>;
  abstract getByLibrary(libraryId: Uuidv4): Promise<any[]>;
  abstract getOutboxOp(id: Uuidv4): Promise<SyncOp>;
  abstract getSyncObject(id: Uuidv4): Promise<SyncObject>;
  abstract deleteOutboxOp(id: Uuidv4): Promise<void>;
  abstract deleteSyncObject(hexIds: Uuidv4[]): Promise<void>;
  abstract clear(): Promise<void>;
}
