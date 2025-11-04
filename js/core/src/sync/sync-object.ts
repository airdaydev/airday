import { LWWRegister } from "../crdt/lww";
import { HexUuid, Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";
import { OpKind } from "../proto";
import { OpHeader, SyncOp } from "./sync-op";

export type KeyMap = { readonly [k: string]: number };
export type RegisterMap<K extends KeyMap> = {
  [P in keyof K]?: LWWRegister<any>;
};

// n.b. keys arrive as ints but internally we use strs to avoid constant type changes
export type NumericAttrMap = { [k: string]: LWWRegister<any> };
export type Change = [id: string, reg?: LWWRegister<any>];
type Listener = (reg: Change) => void;

// State of sync object
export class SyncObject {
  readonly objKind: number;
  id: Uuidv4;
  libraryId: Uuidv4;
  // Sync state concerns
  seq: bigint | null = null; // server id i.e. last_seq (last seen seq)
  // Attributes
  raw: Uint8Array = new Uint8Array(); // TODO: store or naaaah...?
  state: NumericAttrMap = {}; // optimistic client state
  committed: NumericAttrMap = {}; // We don't necessarily need this in memory...
  // TODO: ops tracking (are we sure?)
  pendingOps = new Map<HexUuid, OpHeader>();
  committedOps = new Map<HexUuid, OpHeader>();
  // TODO: Track pending ops
  // TODO: Last access number to determine whether to trim full obj from mem storage
  hash?: Uint8Array; // committed hash
  // Reactivity
  private subs = new Set<Listener>();
  private pending = new Map<string, LWWRegister<any> | undefined>();
  private scheduled = false;

  constructor(op: SyncOp) {
    // TODO: Guards for objects without objKind/id/libId
    this.objKind = op.objKind;
    this.id = op.objId;
    this.libraryId = op.libraryId;
    this.applyLocal(op);
    return this;
  }

  subscribe(cb: Listener): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  private notify(val: any) {
    for (const cb of this.subs.values()) {
      cb(val);
    }
  }

  private markChanged(id: string, reg?: LWWRegister<any>) {
    this.pending.set(id, reg);
    if (!this.scheduled) {
      this.scheduled = true;
      // TODO: Point of microtask is to batch changes made in same code path
      queueMicrotask(() => {
        this.scheduled = false;
        if (!this.pending.size) return;
        const out: Change[] = [];
        for (const [id, reg] of this.pending) {
          out.push([id, reg]);
        }
        this.pending.clear();
        this.notify(out);
      });
    }
  }
  toIdb(): DBSyncObject {
    // Create attribute flatbuffer blob
    return {
      id: this.id,
      objKind: this.objKind,
      libraryId: this.libraryId,
      seq: this.seq,
      // TODO: commit & optimistic & op headers & pending
    };
  }

  applyLocal(op: SyncOp) {
    // Affect this.state immediately
    // TODO: Test types/library match?
    // TODO: Wipe ops with lower seqs for snapshots
    if (op.opKind === OpKind.DELETE) {
      throw new Error("this API for patch/snapshot only currently");
    }
    if (op.patch) {
      this.merge(this.state, op.patch);
    }
    this.pendingOps.set(op.id.toHex(), op.header());
  }

  commitPatch(op: SyncOp) {
    // Affect this.snapshot
    if (op.opKind === OpKind.DELETE) {
      throw new Error("this API for patch/snapshot only currently");
    }
    // TODO: Header should be saved on object itself + sha_256 calculated
    if (op.patch) {
      this.merge(this.committed, op.patch);
    }
    const hexId = op.id.toHex();
    this.pendingOps.delete(hexId);
    this.committedOps.set(hexId, op.header());
    // TODO: For snapshots, clear all committed ops before snapshot
    // TODO: should server reject snapshots where seq > base_seq (yes if there is a snapshot with higher or same base_seq, no if op seq is higher (possible if same compaction rules and both online and both update))
  }

  buildPatch(patch: NumericAttrMap): SyncOp {
    return new SyncOp({
      libraryId: this.libraryId,
      objId: this.id,
      objKind: this.objKind,
      opKind: OpKind.PATCH,
      patch,
    });
  }

  private merge(target: NumericAttrMap, patch: NumericAttrMap) {
    for (const key of Object.keys(patch)) {
      const existingVal = target[key];
      const patchVal = patch[key];
      if (!existingVal) {
        target[key] = patch[key];
      } else {
        const result = existingVal.merge(patchVal);
        target[key] = result.register;
        // TODO: This should be targeted - not required on commit
        this.markChanged(key, result.register); // UI reaction
      }
    }
  }
}

// TODO: Delete this in favour of custom-built meta and attributes (split)
const DBSyncObjectSchema = v.object({
  id: v.any().required(),
  objKind: v.number().required(),
  libraryId: v.any(),
  seq: v.anyOf([v.unknown(), v.null()]),
  attributes: v.any(), // TODO: Blob?
});

export type DBSyncObject = TypeOf<typeof DBSyncObjectSchema>;

export function parseGenericSyncObject(record: any) {
  ensureDBSyncObject(record); // TODO: First check if syncobject is good, then do attributes
  let syncObject = record as DBSyncObject;
  const meta = {
    id: Uuidv4.fromHex(syncObject.id),
    objKind: syncObject.objKind,
    libraryId: Uuidv4.fromHex(syncObject.libraryId),
    attributes: syncObject.attributes,
  };
  return meta;
}

const ensureDBSyncObject = compile(DBSyncObjectSchema, {
  ensure: true,
});
