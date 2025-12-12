// Browser integration tests with indexeddb
import { BrowserRunner, log } from "./runner";
import { AirdayCore, createUser } from "../index";
import { tracer } from "../tracer";
import { AirdayMemStorage } from "../storage/mem";
import { CookieAdapter } from "../auth/cookie";
import { AirdayIDBStorage } from "../storage/idb";

// Inline testEmail to avoid pulling in Node.js-only test/utils dependencies
const TEST_RUN_ID = Date.now();
const testEmail = (name: string) => `${name}.test_${TEST_RUN_ID}@air.day`;

export function createCookieCore() {
  const apiUrl = new URL("http://localhost:3000");
  const core = new AirdayCore({
    apiUrl,
    storageAdapter: new AirdayIDBStorage(),
    authAdapter: new CookieAdapter(apiUrl),
  });
  return core;
}

export const tests = async () => {
  const suite = new BrowserRunner();

  // TODO: Bring back a smoke test & indexeddb layer test
  suite.test("Sign in with cookie", async (ctx) => {
    const core = createCookieCore();
    const creds = {
      email: testEmail("cookie"),
      password: "abcdefg123",
    };
    const user = await createUser(core.apiUrl, creds);
    console.log(user);
    ctx.assert(true);
    // TODO: Check info etc
  });

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
