// Headless sync tests
import { test, expect } from "bun:test";
import { Uuidv4 } from "../src/common/uuid";
import { NumericAttrMap, SyncObject } from "../src/sync/sync-object";
import { LWWRegister } from "../src/crdt/lww";
import { createAuthenticatedCore } from "./utils";
import { InitialSnapshotOp, SyncOp } from "../src/sync/sync-op";
import { OpKind, SyncOpProto } from "../src/proto";
import { Builder, ByteBuffer } from "flatbuffers";

// TODO: Null state to clear? or explicit clear field?
test("create, encode & decode patch SyncOp", async () => {
  const libraryId = new Uuidv4();
  const snapshot = new InitialSnapshotOp({
    libraryId,
    objKind: 0,
    patch: {
      1: new LWWRegister({
        data: "test",
      }),
    },
  });
  // Create a patch + sync object
  const obj = new SyncObject(snapshot);
  expect(snapshot.serialiseAttrs().length).toBe(88);
  expect(obj.pendingOps.size).toBe(1);

  const builder = new Builder();
  const offset = snapshot.addToFlatBuffer(builder);
  builder.finish(offset);
  const serialised = builder.asUint8Array();
  // Parse
  const bb = new ByteBuffer(serialised);
  const proto = SyncOpProto.getRootAsSyncOpProto(bb);
  const op = SyncOp.fromSyncOpProto(proto);
  expect(op.opKind).toBe(OpKind.SNAPSHOT);
  expect(op.objKind).toBe(snapshot.objKind);
  expect(op.objId.equals(snapshot.objId), "objId matches").toBeTrue();
  expect(
    op.libraryId.equals(snapshot.libraryId),
    "libraryId matches",
  ).toBeTrue();
  expect(op.patch[1].data).toBe("test");
});

test("Phase 1 commit", async () => {
  const libraryId = new Uuidv4();
  const snapshot = new InitialSnapshotOp({
    libraryId,
    objKind: 0,
    patch: {
      0: new LWWRegister({
        data: "test",
      }),
    },
  });
  const obj = new SyncObject(snapshot);
  expect(obj.pendingOps.size).toBe(1);
  const map: NumericAttrMap = {
    0: new LWWRegister({
      data: "hello again",
    }),
    1: new LWWRegister({
      data: 64,
    }),
  };
  const patch = obj.buildPatch(map);
  console.log("applying", patch);
  obj.applyLocal(patch);
  expect(obj.state[0].data).toBe("hello again");
  expect(obj.state[1].data).toBe(64);
  expect(obj.pendingOps.size).toBe(2);
});

test.only("Phase 2 commit", async () => {
  const core = await createAuthenticatedCore();
  const libraryId = new Uuidv4();
  const snapshot = new InitialSnapshotOp({
    libraryId,
    objKind: 0,
    patch: {
      0: new LWWRegister({
        data: "test",
      }),
    },
  });
  const obj = new SyncObject(snapshot);
  // TODO: P'raps we should just feed it the object & it can read the pending ops from it (err no because it only keeps head at that point)
  await core.sync.queueOp(snapshot, obj);
  // Test outbox - in mem version
  const outboxOp = core.sync.outbox.get(snapshot.id.toHex());
  expect(outboxOp, "memory stored outbox op").toBe(snapshot);
  // Test outbox - idb version
  const outboxOpIdb = await core.storage.adapter.getOutboxOp(snapshot.id);
  // TODO: Next test passes but it is still a serialised format
  expect(
    outboxOpIdb.id.equals(outboxOp.id),
    "serialised version stored in idb",
  ).toBe(true);
  await new Promise((resolve) => {
    core.ws.events.once("op-response", (data) => {
      resolve(null);
    });
  });
  // We are only doing this after to ensure op-response fires
  // const syncObject = await core.storage.getObj(obj.id);
  // TODO: We should clear & check storage backed version too (at least in a dedicated test!)
  // expect(syncObject, "obj cached in mem cache").toBe(obj);

  // expect(
  //   core.sync.outbox.size,
  //   "ack message received & pending queue back to 0",
  // ).toBe(0);
  // seq persisted to sync object
  // expect(syncObject?.seq, "seq persisted to sync object").toBeGreaterThan(0);
  // const res = await core.storage.adapter.getByLibrary(core.library.id!);
  // const item = res[0];
  // expect(
  //   syncObject!.id.equals(item.id),
  //   "correct libraryId stored in idb",
  // ).toBeTrue();
  // await new Promise((resolve) => {
  //   if (core.sync.outbox.size === 0) {
  //     return resolve(null);
  //   }
  //   core.sync.events.onceAsync("flushed").then(resolve);
  // });
  core.ws.close();
});

test.skip("fan out to connection on same library", () => {});

// TODO: This particular case kind of sucks requiring pushing both the obj & the syncop
test.skip("Catch up stream", async (ctx) => {
  const core = await createAuthenticatedCore();
  // create 50 items
  const libraryId = new Uuidv4();
  let objs = [];
  for (let i = 0; i < 100; i++) {
    const snapshot = new InitialSnapshotOp({
      libraryId,
      objKind: 0,
      patch: {
        0: new LWWRegister({
          data: "test",
        }),
      },
    });
    const obj = new SyncObject(snapshot);
    objs.push(obj);
  }
  // objs.map((obj) => core.sync.queueOp(obj, obj));
  // await core.sync.flush();
  // Clear database (TODO: Direct access??)
  // await core.storage.adapter.clear();
  // const emptyRes = await core.storage.adapter.getByLibrary(core.library.id!);
  // ctx.assertEq(emptyRes.length, 0, "idb has been emptied");
  // Retrieve all items
  // core.sync.getItemSince(core.library.id!, null);
  // await core.sync.flush(); // TODO: This won't function without an ack (perhaps wait until db is synced!)
  // const res = await core.db.item.getItemsByLibrary(core.library.id!.toHex());
  // console.log("items returned", res.length);
  core.ws.close();
});

test.skip("Delete attribute patches", async (assert) => {});
test.skip("Delete object patches", async (assert) => {});
test.skip("Snapshots", async (assert) => {});
test.skip("Merkle tree backed sync discrepency resolution", async (assert) => {});
test.skip("Double OP ids w different sha256s?", async (assert) => {});

test.skip("mem adapter", () => {
  // // Examples for the solid adapter within the web app:
  // class AirdayUIItem {}
  // class AirdayUIContainer {}
  // class SolidAdapterExample {
  //   items: Map<string, AirdayUIItem> = new Map(); // reactive
  //   containers: Map<string, AirdayUIContainer> = new Map(); // reactive
  //   constructor() {}
  // }
  // const solidAdapter = new SolidAdapterExample();
});

test.skip("Get all libraries", async (assert) => {});
test.skip("Create library", async (assert) => {});
test.skip("Delete library", async (assert) => {});
test.skip("Sync local pending changes from idb", async (assert) => {});
