// Browser integration tests with indexeddb
import { BrowserRunner, log } from "./runner";
import { AirdayCore, AuthMode, createUser } from "../index";
import { tracer } from "../tracer";
import { LWWRegister } from "../crdt/lww";
import { Uuidv4 } from "../common/uuid";
import { SyncObject } from "../sync/sync-object";
import { AirdayMemStorage } from "../storage/mem";

// TODO: Performance testing!
export async function authenticate(core: AirdayCore, email: string) {
  const password = "fa09j20fiaj3fpaof";
  await createUser(core, {
    email,
    password,
  });
  await core.loginWithPasswordBearer({ email, password });
  return core;
}

export async function createTestCore() {
  const core = new AirdayCore({
    rootUrl: "http://localhost:3000",
    authMode: AuthMode.BearerToken,
    storageAdapter: new AirdayMemStorage(),
  });
  await authenticate(core, `${Math.random()}@airday.com}`);
  await core.storage.adapter.connect();
  core.ws.connect();
  await core.ws.events.onceAsync("authenticated");
  return core;
}

export const tests = async () => {
  const suite = new BrowserRunner();

  // TODO: Null values to clear? or explicit clear field?
  suite.test("Create, encode & decode SyncOp via SyncObject", async (ctx) => {
    const libraryId = new Uuidv4();
    // Create an object
    const syncObj = new SyncObject({
      objKind: 0,
      libraryId,
    });
    syncObj.values[0] = new LWWRegister({
      data: "hello",
    });
    syncObj.values[1] = new LWWRegister({
      data: 32,
    });
    syncObj.values[2] = new LWWRegister({
      data: false,
    });
    const buffer = syncObj.getFullAttrPayload();
    ctx.assertEq(buffer.byteLength, 184);
    // Parse
    const syncObjB = new SyncObject({
      objKind: 0,
      libraryId,
    });
    syncObjB.parseAttrSet(buffer);
    ctx.assertEq(syncObjB.values[0].data, "hello");
    ctx.assertEq(syncObjB.values[1].data, 32);
    ctx.assertEq(syncObjB.values[2].data, false);
  });

  // suite.test("Merge SyncObject", async (ctx) => {
  //   const library = new Uuidv4();
  //   const syncObj = new SyncObject({
  //     objKind: 0,
  //     libraryId: library,
  //   });
  //   syncObj.values[0] = new LWWRegister({
  //     data: "hello",
  //   });
  //   syncObj.values[1] = new LWWRegister({
  //     data: 32,
  //   });
  //   const patch: NumericAttrMap = {
  //     0: new LWWRegister({
  //       data: "hello again",
  //     }),
  //     1: new LWWRegister({
  //       data: 64,
  //     }),
  //   };
  //   syncObj.values[0] = new LWWRegister({
  //     data: "hello again",
  //   });
  //   syncObj.values[1] = new LWWRegister({
  //     data: 64,
  //   });

  //   syncObj.mergePatch(patch, true);
  //   ctx.assertEq(syncObj.values[0].data, "hello again");
  //   ctx.assertEq(syncObj.values[1].data, 64);
  // });

  // suite.only("Sync generic object", async (ctx) => {
  //   const core = await createTestCore();
  //   const syncObj = new SyncObject({
  //     objKind: 0,
  //     libraryId: core.library.id!,
  //   });
  //   syncObj.values[0] = new LWWRegister({
  //     data: "hello",
  //   });
  //   const op = syncObj.fullSyncOp();
  //   console.log("yo wut");
  //   const patch = {
  //     1: new LWWRegister({
  //       data: "goodbye",
  //     }),
  //   };
  //   // TODO: Potentially roll mergePatch + queueOp into a single api
  //   syncObj.mergePatch(patch, true);
  //   console.log("merged patch");
  //   // const op2 = syncObj.partialSyncOp(patch);
  //   await core.sync.queueOp(op, syncObj);
  //   // Test outbox - in mem version
  //   const outbox = core.sync.outbox.get(op.id.toHex());
  //   if (!outbox?.id) throw new Error("fail test early");
  //   ctx.assert(op.id.equals(outbox.id), "message gets placed in-mem outbox");
  //   // Test outbox - idb version
  //   const outboxOpIdb = await core.storage.adapter.getOutboxOp(op.id);
  //   ctx.assert(
  //     op.id.equals(outboxOpIdb.id),
  //     "modified sync object gets stored in durable memory",
  //   );
  //   // Test in mem version
  //   const syncObject = core.storage.getSyncObjectById(syncObj.id);
  //   ctx.assert(!!syncObject, "recent sync object is in hot storage");
  //   ctx.assertEq(syncObject, op.syncObject, "Sync object is not copied");
  //   // test sync completion
  //   await new Promise((resolve) => {
  //     core.ws.events.once("batch-response", (data) => {
  //       resolve(null);
  //     });
  //   });
  //   ctx.assertEq(
  //     core.sync.outbox.size,
  //     0,
  //     "ack message received & pending queue back to 0",
  //   );
  //   // seq persisted to sync object
  //   ctx.assert(
  //     !!syncObj.seq && syncObj.seq > 0,
  //     "seq persisted to sync object",
  //   );
  //   const res = await core.storage.adapter.getByLibrary(core.library.id!);
  //   const item = res[0];
  //   ctx.assert(
  //     syncObject!.id.equals(item.id),
  //     "correct libraryId stored in idb",
  //   );
  //   await new Promise((resolve) => {
  //     if (core.sync.outbox.size === 0) {
  //       return resolve(null);
  //     }
  //     core.sync.events.onceAsync("flushed").then(resolve);
  //   });
  //   core.ws.close();
  // });

  // suite.test("Items stored in indexeddb", async (ctx) => {
  //   const core = await createTestCore();
  //   let ops = [];
  //   const qty = 100;
  //   for (let i = 0; i < qty; i++) {
  //     const item = new SyncObject({
  //       objKind: 0,
  //       libraryId: core.library.id!,
  //     });
  //     item.values[0] = new LWWRegister({ data: "test" });
  //     const op = item.fullSyncOp();
  //     ops.push(op);
  //     // TODO: Ok we definitely need a paired version
  //     await core.sync.queueOp(op, item);
  //   }
  //   await core.ws.flush();
  //   const res = await core.storage.adapter.getByLibrary(core.library.id!);
  //   ctx.assertEq(res.length, qty, "correct res length");
  //   core.ws.close();
  // });

  // suite.test("Merge text same message", async (ctx) => {
  //   // 1. Create item & sync it
  //   const core = await createTestCore();
  //   const oldText = new LWWRegister({ data: "old_text" });
  //   const item = new SyncObject({
  //     objKind: 0,
  //     libraryId: core.library.id!,
  //   });
  //   item.values[0] = new LWWRegister({ data: "test" });
  //   const op = item.fullSyncOp();
  //   core.sync.queueOp(op, item);
  //   await core.sync.flush();
  //   ctx.assertEq(core.sync.outbox.size, 0, "outbox is clear after sync");

  //   // 2. After sync is acknowledged, update it again
  //   const patch = {
  //     0: new LWWRegister({ data: "new_text" }),
  //   };
  //   ctx.assert(
  //     patch[0].timestamp.greaterThan(oldText.timestamp)!,
  //     "new text older than old text",
  //   );
  //   const op2 = item.partialSyncOp(patch);
  //   ctx.assertEq(item.values[0].data, patch[0].data, "merge success");
  //   core.sync.queueOp(op2, item);
  //   await core.sync.flush();
  //   core.ws.close();
  // });

  // suite.skip("fan out to connection on same library", () => {});

  // suite.test("Get all items since beginning from server", async (ctx) => {
  //   const core = await createTestCore();
  //   // create 50 items
  //   let objs = [];
  //   for (let i = 0; i < 100; i++) {
  //     const syncObject = new SyncObject({
  //       objKind: 0,
  //       libraryId: core.library.id!,
  //     });
  //     syncObject.values[0] = new LWWRegister({ data: "test" });
  //     objs.push(syncObject);
  //   }
  //   objs.map((obj) => core.sync.queueOp(obj.fullSyncOp(), obj));
  //   await core.sync.flush();
  //   // Clear database (TODO: Direct access??)
  //   await core.storage.adapter.clear();
  //   const emptyRes = await core.storage.adapter.getByLibrary(core.library.id!);
  //   ctx.assertEq(emptyRes.length, 0, "idb has been emptied");
  //   // Retrieve all items
  //   // core.sync.getItemSince(core.library.id!, null);
  //   // await core.sync.flush(); // TODO: This won't function without an ack (perhaps wait until db is synced!)
  //   // const res = await core.db.item.getItemsByLibrary(core.library.id!.toHex());
  //   // console.log("items returned", res.length);
  //   core.ws.close();
  // });

  // suite.skip("Tombstones", async (assert) => {});
  // suite.skip("Snapshots", async (assert) => {});
  // suite.skip("Merkles", async (assert) => {});
  // suite.skip("Double OP ids w different sha256s?", async (assert) => {});

  // suite.skip("mem adapter", () => {
  //   // // Examples for the solid adapter within the web app:
  //   // class AirdayUIItem {}
  //   // class AirdayUIContainer {}
  //   // class SolidAdapterExample {
  //   //   items: Map<string, AirdayUIItem> = new Map(); // reactive
  //   //   containers: Map<string, AirdayUIContainer> = new Map(); // reactive
  //   //   constructor() {}
  //   // }
  //   // const solidAdapter = new SolidAdapterExample();
  // });

  // suite.skip("Get all libraries", async (assert) => {});
  // suite.skip("Sync local pending changes from idb", async (assert) => {});

  const results = await suite.run();
  log("Flushing");
  await tracer.flushNow();
  log(`${results.passed}/${results.total} tests passed`);
  if (window.sendToPlaywright) window.sendToPlaywright(results as any);
};
