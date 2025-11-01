import { LWWRegister, LWWTimestamp } from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { compile, v, type TypeOf } from "suretype";
import { Builder, ByteBuffer } from "flatbuffers";
import {
  AttributeProto,
  AttributeSetProto,
  AttrTypeProto,
  OpKind,
} from "../proto";
import { SyncOp } from "./sync-op";

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
  // TODO: Track pending ops
  // TODO: Last access number to determine whether to trim full obj from mem storage
  hash?: Uint8Array; // committed hash
  dirty: Set<string> = new Set(); // Updated locally, but not accepted (str rep of identifier)
  // Reactivity
  private subs = new Set<Listener>();
  private pending = new Map<string, LWWRegister<any> | undefined>();
  private scheduled = false;

  constructor(params: SyncObjectParams) {
    this.objKind = params.objKind;
    this.id = params.id || new Uuidv4();
    this.libraryId = params.libraryId;
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

  applyPatchLocal(op: SyncOp) {
    // Affect this.state immediately
    if (op.opKind !== OpKind.PATCH) {
      throw new Error("this API for patch only currently");
    }
  }

  commitPatch(op: SyncOp) {
    // Affect this.snapshot
    if (op.opKind !== OpKind.PATCH || !op.patch) {
      throw new Error("this API for patch only currently");
    }
    this.merge(this.committed, op.patch);
  }

  merge(target: NumericAttrMap, patch: NumericAttrMap) {
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

  mergePatch(map: NumericAttrMap, local: boolean) {
    for (const key of Object.keys(map)) {
      const curVal = this.state[key];
      if (!curVal) {
        this.state[key] = curVal;
      } else {
        const otherVal = map[key];
        if (!otherVal) throw new Error("val is set but not populated");
        const result = curVal.merge(otherVal as any); // TODO: do we want to validate type on every merge/extraction?
        if (result.source === "right" && local === false) {
          this.dirty.delete(key);
        }
        this.state[key] = result.register;
        this.markChanged(key, result.register);
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

export interface SyncObjectParams {
  id?: Uuidv4;
  libraryId: Uuidv4;
  lastModified?: bigint;
  lastSync?: bigint;
  objKind: number;
}
