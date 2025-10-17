import { Uuidv4 } from "../common/uuid";
import { SyncOp } from "../sync/fb";

// Generic persistence layer
export abstract class StorageAdapter {
  abstract connect(): Promise<void>;
  abstract addOps(ops: SyncOp[]): Promise<void>;
  abstract getByLibrary(libraryId: Uuidv4): Promise<any[]>;
  abstract getOutboxItem(id: Uuidv4): Promise<void>;
  abstract getSyncObject(id: Uuidv4): Promise<void>;
  abstract delete(hexIds: Uuidv4[]): Promise<void>;
}
