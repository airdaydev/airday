import { BrowserRunner, log } from "./runner";
import { AirdayCore, AirdayItem, AuthMode, createUser } from "../index";
import { LWWRegisterString } from "../crdt/lww";
import { tracer } from "../tracer";

export async function authenticate(core: AirdayCore, email: string) {
  const password = "fa09j20fiaj3fpaof";
  await createUser(core, {
    email,
    password,
  });
  await core.loginWithPasswordBearer({ email, password });
  return core;
}

export function createTestCore() {
  return new AirdayCore({
    rootUrl: "http://localhost:3000",
    authMode: AuthMode.BearerToken,
  });
}

export const tests = async () => {
  const suite = new BrowserRunner();

  const core = createTestCore();
  await authenticate(core, `${Math.random()}@airday.com}`);
  await core.db.connect();
  core.sync.setDB(core.db); // TODO: This should happen automatically
  core.ws.connect();
  // TODO: We shouldn't need async here... or we have to use same access pattern in app
  await new Promise((resolve) => {
    if (core.ws.authorised) return resolve(null);
    core.ws.events.on("authenticated", resolve);
  });

  suite.skip("Sync item", async (assert) => {
    const newItem = new AirdayItem({
      libraryId: core.library.id!,
      attributes: {
        text: LWWRegisterString.fromString("test"),
      },
    });
    let action = core.sync.createItem(newItem);
    const pending = core.sync.pendingActions.get(action.id.toHex());
    assert(pending?.id === action.id);
    await new Promise((resolve) => {
      core.ws.events.once("ack", (data) => {
        // core.ws.close();
        resolve(null);
      });
    });
    assert(core.sync.pendingActions.size === 0);
    const item = (
      await core.db.item.getItemsByLibrary(core.library.id!.toHex())
    )[0];
    assert(item.libraryId.toHex() === core.library.id!.toHex());
    assert(
      typeof item.lastSync === "number" && item.lastSync > item.lastModified,
      "Item timestamps = considered sync",
    );
  });

  suite.test("Sync many items", async (assert) => {
    for (let i = 0; i < 1000; i++) {
      const newItem = new AirdayItem({
        libraryId: core.library.id!,
        attributes: {
          text: LWWRegisterString.fromString("test"),
        },
      });
      let action = core.sync.createItem(newItem);
      const pending = core.sync.pendingActions.get(action.id.toHex());
      assert(pending?.id === action.id);
    }
    await core.ws.flush(); // however... we need to wait til acks are complete...
    // which basically means checking every single ack related to this transaction
    // So i don't think we should be doing this test
    log(core.sync.pendingActions.values().next());
    assert(core.sync.pendingActions.size === 0);
    const items = await core.db.item.getItemsByLibrary(
      core.library.id!.toHex(),
    );
    console.log(items.length);
    // assert(item.libraryId.toHex() === core.library.id!.toHex());
    // assert(
    //   typeof item.lastSync === "number" && item.lastSync > item.lastModified,
    //   "Item timestamps = considered sync",
    // );
  });

  const results = await suite.run();
  log("Flushing");
  await tracer.flushNow();
  log(`${results.passed}/${results.total} tests passed`);
  if (window.sendToPlaywright) window.sendToPlaywright(results as any);
};
