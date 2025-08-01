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

  suite.test("Sync item", async (assert) => {
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
    await new Promise((resolve) => {
      if (core.sync.pendingActions.size === 0) {
        return resolve(null);
      }
      core.sync.events.onceAsync("flushed").then(resolve);
    });
  });

  suite.test("Sync many items", async (assert) => {
    for (let i = 0; i < 100; i++) {
      const newItem = new AirdayItem({
        libraryId: core.library.id!,
        attributes: {
          text: LWWRegisterString.fromString("test"),
        },
      });
      core.sync.createItem(newItem);
    }
    await core.ws.flush();
    await core.sync.events.onceAsync("flushed");
    assert(core.sync.pendingActions.size === 0, "no pending actions!");
    const res = await core.db.item.getItemsByLibrary(core.library.id!.toHex());
    assert(res.length === 101, "res length is 101"); // 101 due to previous test!!
  });

  suite.only("Merge text same message", async (assert) => {
    const oldText = LWWRegisterString.fromString("old_text");
    const item = new AirdayItem({
      libraryId: core.library.id!,
      attributes: {
        text: oldText,
      },
    });
    const newText = LWWRegisterString.fromString("new_text");
    assert(newText.timestamp.greaterThan(oldText.timestamp)!);
    let insertion = core.sync.createItem(item);
    await core.sync.events.onceAsync("flushed");
    item.attributes.text = newText;
    let update = core.sync.createItem(item);
    await core.ws.flush();
    await core.sync.events.onceAsync("flushed");
    const res = await core.db.item.getItemsByLibrary(core.library.id!.toHex());
    // assert(res.length === 101, "res length is 101"); // 101 due to previous test!!
  });

  const results = await suite.run();
  core.ws.close();
  log("Flushing");
  await tracer.flushNow();
  log(`${results.passed}/${results.total} tests passed`);
  if (window.sendToPlaywright) window.sendToPlaywright(results as any);
};
