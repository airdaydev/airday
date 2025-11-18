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
  obj.applyLocal(patch);
  expect(obj.state[0].data).toBe("hello again");
  expect(obj.state[1].data).toBe(64);
  expect(obj.pendingOps.size).toBe(2);
});

// TODO: Test unauthenticated

test("Phase 2 commit", async () => {
  const core = await createAuthenticatedCore();
  const libraryId = core.library.id!;
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
  const patch = obj.buildPatch({
    0: new LWWRegister({
      data: "test2",
    }),
  });
  obj.applyLocal(patch);
  // TODO: P'raps we should just feed it the object & it can read the pending ops from it (err no because it only keeps head at that point)
  await core.sync.queueOp(snapshot, obj);
  await core.sync.queueOp(patch, obj);
  // Test outbox - in mem version
  const outboxOp = core.sync.pendingOps.get(snapshot.id.toHex())!;
  expect(outboxOp, "memory stored outbox op").toBe(snapshot);
  // Test outbox - idb version
  const outboxOpIdb = await core.storage.adapter.getOutboxOp(snapshot.id);
  // TODO: Next test passes but it is still a serialised format
  expect(
    outboxOpIdb.id.equals(outboxOp.id),
    "serialised version stored in idb",
  ).toBe(true);
  await core.sync.flush();
  // We are only doing this after to ensure op-response fires
  const syncObject = await core.storage.getObj(obj.id);
  // TODO: We should clear & check storage backed version too (at least in a dedicated test!)
  expect(syncObject, "obj cached in mem cache").toBe(obj);

  expect(
    core.sync.outbox.length,
    "ack message received & outbox message deleted",
  ).toBe(0);
  expect(
    core.sync.pendingOps.size,
    "ack message received & pending message index removed",
  ).toBe(0);
  expect(syncObject?.maxSeq, "seq persisted to sync object").toBe(1n);
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

test.only("Catch up streams", async () => {
  const core = await createAuthenticatedCore();
  // create x items
  const libraryId = core.library.id!;
  for (let i = 0; i < 1000; i++) {
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
    await core.sync.queueOp(snapshot, obj);
  }
  await core.sync.flush();
  await core.storage.adapter.clear();
  const emptyRes = await core.storage.adapter.getByLibrary(core.library.id!);
  expect(emptyRes.length, "idb has been emptied").toBeEmpty();
  // Retrieve all items
  const stream = core.sync.catchup(core.library.id!, 0);
  await stream.done();
  // HACK
  await new Promise((resolve) => setTimeout(() => resolve(null), 5000));
  // TODO: The processing is done before the items have actually been processed
  const res = await core.storage.adapter.getByLibrary(libraryId);
  console.log("res", res.length);
  // const res = await core.storage.(core.library.id!.toHex());
  core.ws.close();
});

test.skip("Delete attribute patches", async () => {
  const core = await createAuthenticatedCore();
});

test.skip("Delete object patches", async () => {});
test.skip("Snapshots", async () => {});
test.skip("Merkle tree backed sync discrepency resolution", async () => {});
test.skip("Double OP ids w different sha256s?", async () => {});

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

test.skip("Get all libraries", async () => {});
test.skip("Create library", async () => {});
test.skip("Delete library", async () => {});
test.skip("Sync local pending changes from idb", async () => {});
