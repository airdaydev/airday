// Stage 2 of slice 4: the four view-id helpers (live / done / binned)
// plus get_item / get_list_meta as JS-side primitives. Rust unit tests
// cover correctness; this file pins the wasm-bindgen surface so a
// rename or signature drift is caught before the web client breaks.

import { describe, expect, test } from "bun:test";

import { Doc } from "../wasm/airday_core_web.js";

const LIST_MAIN = "main";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("Doc view helpers", () => {
  test("empty doc returns empty arrays for every view", () => {
    const doc = Doc.create();
    expect(doc.liveItemIds(LIST_MAIN)).toEqual([]);
    expect(doc.doneItemIds()).toEqual([]);
    expect(doc.binnedItemIds()).toEqual([]);
  });

  test("liveItemIds returns ids in MovableList order, scoped to list and status", async () => {
    const doc = Doc.create();
    const other = doc.addList("Other");
    const a = doc.addItem(LIST_MAIN, "a");
    const b = doc.addItem(LIST_MAIN, "b");
    const c = doc.addItem(LIST_MAIN, "c");
    doc.addItem(other, "h"); // must not appear in now's view
    doc.setItemDone(b);
    const d = doc.addItem(LIST_MAIN, "d");
    doc.binItem(d);

    expect(doc.liveItemIds(LIST_MAIN)).toEqual([a, c]);
    expect(doc.liveItemIds(other).length).toBe(1);
  });

  test("doneItemIds sorted by doneAt desc with id tiebreaker", async () => {
    const doc = Doc.create();
    const first = doc.addItem(LIST_MAIN, "first");
    const second = doc.addItem(LIST_MAIN, "second");
    const third = doc.addItem(LIST_MAIN, "third");
    doc.setItemDone(first);
    await sleep(2);
    doc.setItemDone(second);
    await sleep(2);
    doc.setItemDone(third);

    expect(doc.doneItemIds()).toEqual([third, second, first]);
  });

  test("binnedItemIds sorted by binnedAt desc", async () => {
    const doc = Doc.create();
    const a = doc.addItem(LIST_MAIN, "a");
    const b = doc.addItem(LIST_MAIN, "b");
    doc.binItem(a);
    await sleep(2);
    doc.binItem(b);
    expect(doc.binnedItemIds()).toEqual([b, a]);
  });

  test("getItemJson and getListMetaJson round-trip through JSON.parse", () => {
    const doc = Doc.create();
    const id = doc.addItem(LIST_MAIN, "xyz");

    const item = JSON.parse(doc.getItemJson(id)!);
    expect(item.id).toBe(id);
    expect(item.text).toBe("xyz");
    expect(item.listId).toBe(LIST_MAIN);
    expect(item.status).toBe("live");

    expect(doc.getItemJson("does-not-exist")).toBeUndefined();

    // `main` is a reserved id with no MovableList entry — clients render
    // its label themselves, so getListMetaJson(LIST_MAIN) is undefined.
    expect(doc.getListMetaJson(LIST_MAIN)).toBeUndefined();

    const userListId = doc.addList("Groceries");
    const list = JSON.parse(doc.getListMetaJson(userListId)!);
    expect(list.id).toBe(userListId);
    expect(list.name).toBe("Groceries");

    expect(doc.getListMetaJson("nope")).toBeUndefined();
  });
});
