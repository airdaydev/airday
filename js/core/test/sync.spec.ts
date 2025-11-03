// Headless sync tests
import { test, expect } from "bun:test";
import { Uuidv4 } from "../src/common/uuid";
import { NumericAttrMap, SyncObject } from "../src/sync/sync-object";
import { LWWRegister } from "../src/crdt/lww";
import { createAuthenticatedCore } from "./utils";
import { InitialSnapshotOp, SyncOp } from "../src/sync/sync-op";
import { OpKind } from "../src/proto";
import { Builder } from "flatbuffers";

// TODO: Null state to clear? or explicit clear field?
test.only("create, encode & decode patch SyncOp", async () => {
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
  snapshot.addToFlatBuffer(builder);
  builder.asUint8Array();
  // Parse
  // syncObjB.parseAttrSet(buffer);
  // expect(syncObjB.state[0].data).toBe("hello");
  // expect(syncObjB.state[1].data).toBe(32);
  // expect(syncObjB.state[2].data).toBe(false);
});

test("Merge SyncObject", async () => {
  const library = new Uuidv4();
  const syncObj = new SyncObject({
    objKind: 0,
    libraryId: library,
  });
  syncObj.state[0] = new LWWRegister({
    data: "hello",
  });
  syncObj.state[1] = new LWWRegister({
    data: 32,
  });
  const patch: NumericAttrMap = {
    0: new LWWRegister({
      data: "hello again",
    }),
    1: new LWWRegister({
      data: 64,
    }),
  };
  syncObj.state[0] = new LWWRegister({
    data: "hello again",
  });
  syncObj.state[1] = new LWWRegister({
    data: 64,
  });

  // const syncObjB = new SyncOp({
  //   opKind: OpKind.PATCH,
  //   objId: obj.id,
  //   objKind: snapshot.objKind,
  //   libraryId,
  //   patch: {
  //     1: new LWWRegister({
  //       data: "updated",
  //     }),
  //     2: new LWWRegister({
  //       data: "added",
  //     }),
  //   },
  // });

  syncObj.mergePatch(patch, true);
  expect(syncObj.state[0].data).toBe("hello again");
  expect(syncObj.state[1].data).toBe(64);
});

test("Sync generic object", async () => {
  const core = await createAuthenticatedCore();
  const syncObj = new SyncObject({
    objKind: 0,
    libraryId: core.library.id!,
  });
  syncObj.state[0] = new LWWRegister({
    data: "hello",
  });
  const op = syncObj.fullSyncOp();
  const patch = {
    1: new LWWRegister({
      data: "goodbye",
    }),
  };
  // TODO: Potentially roll mergePatch + queueOp into a single api
  syncObj.mergePatch(patch, true);
  // const op2 = syncObj.partialSyncOp(patch);
  await core.sync.queueOp(op, syncObj);
  // Test outbox - in mem version
  const outbox = core.sync.outbox.get(op.id.toHex());
  if (!outbox?.id) throw new Error("fail test early");
  expect(
    op.id.equals(outbox.id),
    "message gets placed in-mem outbox",
  ).toBeTrue();
  // Test outbox - idb version
  const outboxOpIdb = await core.storage.adapter.getOutboxOp(op.id);
  expect(
    op.id.equals(outboxOpIdb.id),
    "modified sync object gets stored in durable memory",
  ).toBeTrue();
  // Test in mem version
  const syncObject = core.storage.getStateCache(syncObj.id);
  expect(syncObject, "recent sync object is in hot storage").toBeTruthy();
  // test sync completion
  await new Promise((resolve) => {
    core.ws.events.once("op-response", (data) => {
      resolve(null);
    });
  });
  expect(
    core.sync.outbox.size,
    "ack message received & pending queue back to 0",
  ).toBe(0);
  // seq persisted to sync object
  expect(syncObject?.seq, "seq persisted to sync object").toBeGreaterThan(0);
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
