import { SimpleTest, assertEqual, assert } from "./runner";
import { AirdayCore, AirdayItem, AuthMode, createUser } from "../index";
import { LWWRegisterString } from "../crdt/lww";

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
  const suite = new SimpleTest();

  suite.test("async test", async () => {
    const core = createTestCore();
    await authenticate(core, `${Math.random()}@airday.com}`);
    await core.db.connect();
    core.sync.setDB(core.db); // TODO: This should happen automatically
    core.ws.connect();
    // TODO: We shouldn't need async here... or we have to use same access pattern in app
    await new Promise((resolve) => {
      console.log("is ws authorised?", core.ws.authorised);
      if (core.ws.authorised) return resolve(null);
      core.ws.events.on("authenticated", resolve);
    });
    const newItem = new AirdayItem({
      libraryId: core.library.id!,
      attributes: {
        text: LWWRegisterString.fromString("test"),
      },
    });
    let action = core.sync.createItem(newItem);
    const pending = core.sync.pendingActions.get(action.id.toHex());
    // expect(pending?.id).toBe(action.id);
    await new Promise((resolve) => {
      core.ws.events.once("ack", (data) => {
        console.log(data);
        core.ws.close();
        resolve(null);
      });
      // expect(core.sync.pendingActions.size).toBe(0);
      // const item = (
      //   await core.db.item.getItemsByLibrary(core.library.id!.toHex())
      // )[0];
      // expect(item.libraryId.toHex()).toBe(core.library.id!.toHex());
      // expect(item.lastSync, "Item timestamps = considered sync").toBeGreaterThan(
      //   item.lastModified,
      // );
    });
  });

  const results = await suite.run();
  console.log(`${results.passed}/${results.total} tests passed`);
  if (window.sendToPlaywright) window.sendToPlaywright(results as any);
};

// -const core = createTestCore();
// -
// -beforeAll(async () => {
// -  await authenticate(core, `${Math.random()}@airday.com}`);
// -  await core.db.connect();
// -  core.sync.setDB(core.db); // TODO: This should happen automatically
// -test("Item sync", async () => {
// -  core.ws.connect();
// -  // TODO: We shouldn't need async here... or we have to use same access pattern in app
// -  core.ws.connect();
// -  // TODO: We shouldn't need async here... or we have to use same access pattern in app
