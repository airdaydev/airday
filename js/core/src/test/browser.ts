import { BrowserRunner, log } from "./runner";
import { AirdayCore, AirdayItem, AuthMode, createUser } from "../index";
import { LWWRegisterString } from "../crdt/lww";
import { tracer } from "../tracer";

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
  });
  await authenticate(core, `${Math.random()}@airday.com}`);
  await core.storage.idb.connect();
  core.ws.connect();
  await core.ws.events.onceAsync("authenticated");
  return core;
}

export const tests = async () => {
  const suite = new BrowserRunner();

  suite.test("Sync item", async (assert) => {
    const core = await createTestCore();
    const newItem = new AirdayItem({
      libraryId: core.library.id!,
      attributes: {
        text: LWWRegisterString.fromString("test"),
      },
    });
    let action = core.sync.syncItems([newItem])[0];
    const pending = core.sync.pendingActions.get(action.id.toHex());
    assert(pending?.id === action.id, "message gets placed on pending queue");
    await new Promise((resolve) => {
      core.ws.events.once("batch-response", (data) => {
        resolve(null);
      });
    });
    assert(
      core.sync.pendingActions.size === 0,
      "ack message received & pending queue back to 0",
    );
    const item = (
      await core.storage.idb.getByLibrary(core.library.id!.toHex())
    )[0];
    assert(
      item.libraryId.toHex() === core.library.id!.toHex(),
      "correct libraryId stored in idb",
    );
    assert(
      typeof item.lastSync === "bigint" && item.lastSync > item.lastModified,
      "Item timestamps = considered in sync",
    );
    await new Promise((resolve) => {
      if (core.sync.pendingActions.size === 0) {
        return resolve(null);
      }
      core.sync.events.onceAsync("flushed").then(resolve);
    });
    core.ws.close();
  });

  suite.test("Items stored in indexeddb", async (assert) => {
    const core = await createTestCore();
    let items = [];
    for (let i = 0; i < 100; i++) {
      items.push(
        new AirdayItem({
          libraryId: core.library.id!,
          attributes: {
            text: LWWRegisterString.fromString("test"),
          },
        }),
      );
    }
    core.sync.syncItems(items);
    await core.ws.flush();
    const res = await core.storage.idb.getByLibrary(core.library.id!.toHex());
    assert(res.length === 100, "res length");
    // TODO: Get all items
    // core.sync.getItemSince(core.library.id!, null);
    core.ws.close();
  });

  suite.only("Merge text same message", async (assert) => {
    // 1. Create item & sync it
    const core = await createTestCore();
    const oldText = LWWRegisterString.fromString("old_text");
    const item = new AirdayItem({
      libraryId: core.library.id!,
      attributes: {
        text: oldText,
      },
    });
    core.sync.syncItems([item]);
    await core.sync.flush();
    assert(item.isSynced() === true, "Item has been synced");
    console.log("sync 1 completed");

    // 2. After sync is acknowledged, update it again
    const newText = LWWRegisterString.fromString("new_text");
    assert(
      newText.timestamp.greaterThan(oldText.timestamp)!,
      "new text older than old text",
    );
    item.applyLocal({ text: newText }); // TODO: This should trigger a sync
    assert(item.attributes.text?.data === newText.data, "merge success");
    assert(item.isSynced() === false, "item considered not synced");
    console.log("sync 2");
    core.sync.syncItems([item]);
    await core.sync.flush(); // TODO: Awaiting here indefinitely
    assert(item.isSynced() === true, "item now considered as synced");
    // const res = await core.db.item.getItemsByLibrary(core.library.id!.toHex());
    // assert(res.length === 101, "res length is 101"); // 101 due to previous test!!
    core.ws.close();
  });

  suite.skip("Immediate updates after initial sync", async (assert) => {
    // TODO: Test update before flush!
  });

  suite.test("Get all items since beginning from server", async (assert) => {
    const core = await createTestCore();
    // create 50 items
    let items = [];
    for (let i = 0; i < 100; i++) {
      items.push(
        new AirdayItem({
          libraryId: core.library.id!,
          attributes: {
            text: LWWRegisterString.fromString("test"),
          },
        }),
      );
    }
    core.sync.syncItems(items);
    await core.sync.flush();
    // Clear database (TODO: Direct access??)
    await core.storage.idb.handle?.clear("syncable");
    await core.storage.idb.handle?.clear("library");
    const emptyRes = await core.storage.idb.getByLibrary(
      core.library.id!.toHex(),
    );
    assert(emptyRes.length === 0, "idb has been emptied");
    // Retrieve all items
    // core.sync.getItemSince(core.library.id!, null);
    // await core.sync.flush(); // TODO: This won't function without an ack (perhaps wait until db is synced!)
    // const res = await core.db.item.getItemsByLibrary(core.library.id!.toHex());
    // console.log("items returned", res.length);
    core.ws.close();
  });

  suite.skip("mem adapter", () => {
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

  // suite.skip("Get diff items", async (assert) => {});
  // suite.skip("Get all libraries", async (assert) => {});
  // suite.skip("Get all lists", async (assert) => {});
  // suite.skip("Get diff lists", async (assert) => {});
  // suite.skip("Sync local pending changes from idb", async (assert) => {});

  const results = await suite.run();
  log("Flushing");
  await tracer.flushNow();
  log(`${results.passed}/${results.total} tests passed`);
  if (window.sendToPlaywright) window.sendToPlaywright(results as any);
};
