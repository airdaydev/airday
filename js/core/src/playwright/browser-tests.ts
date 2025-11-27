// Browser integration tests with indexeddb
import { BrowserRunner, log } from "./runner";
import { AirdayCore, createUser } from "../index";
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

  // TODO: Bring back a smoke test & indexeddb layer test

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

  const results = await suite.run();
  log("Flushing");
  await tracer.flushNow();
  log(`${results.passed}/${results.total} tests passed`);
  if (window.sendToPlaywright) window.sendToPlaywright(results as any);
};
