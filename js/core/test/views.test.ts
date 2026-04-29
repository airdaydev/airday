// Stage 2 of slice 4: the four view-id helpers (live / done / binned)
// plus get_item / get_list_meta as JS-side primitives. Rust unit tests
// cover correctness; this file pins the wasm-bindgen surface so a
// rename or signature drift is caught before the web client breaks.

import { describe, expect, test } from "bun:test";

import { Doc } from "../wasm/airday_core_web.js";

const LIST_CURRENT = "current";
const LIST_HOLDING = "holding";

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

describe("Doc view helpers", () => {
  test("empty doc returns empty arrays for every view", () => {
    const doc = Doc.create();
    expect(doc.liveItemIds(LIST_CURRENT)).toEqual([]);
    expect(doc.doneItemIds()).toEqual([]);
    expect(doc.binnedItemIds()).toEqual([]);
  });

  test("liveItemIds returns ids in MovableList order, scoped to list and status", async () => {
    const doc = Doc.create();
    const a = doc.addItem(LIST_CURRENT, "a");
    const b = doc.addItem(LIST_CURRENT, "b");
    const c = doc.addItem(LIST_CURRENT, "c");
    doc.addItem(LIST_HOLDING, "h"); // must not appear in current's view
    doc.setItemDone(b);
    const d = doc.addItem(LIST_CURRENT, "d");
    doc.binItem(d);

    expect(doc.liveItemIds(LIST_CURRENT)).toEqual([a, c]);
    expect(doc.liveItemIds(LIST_HOLDING).length).toBe(1);
  });

  test("doneItemIds sorted by doneAt desc with id tiebreaker", async () => {
    const doc = Doc.create();
    const first = doc.addItem(LIST_CURRENT, "first");
    const second = doc.addItem(LIST_CURRENT, "second");
    const third = doc.addItem(LIST_CURRENT, "third");
    doc.setItemDone(first);
    await sleep(2);
    doc.setItemDone(second);
    await sleep(2);
    doc.setItemDone(third);

    expect(doc.doneItemIds()).toEqual([third, second, first]);
  });

  test("binnedItemIds sorted by binnedAt desc", async () => {
    const doc = Doc.create();
    const a = doc.addItem(LIST_CURRENT, "a");
    const b = doc.addItem(LIST_CURRENT, "b");
    doc.binItem(a);
    await sleep(2);
    doc.binItem(b);
    expect(doc.binnedItemIds()).toEqual([b, a]);
  });

  test("getItemJson and getListMetaJson round-trip through JSON.parse", () => {
    const doc = Doc.create();
    const id = doc.addItem(LIST_CURRENT, "xyz");

    const item = JSON.parse(doc.getItemJson(id)!);
    expect(item.id).toBe(id);
    expect(item.text).toBe("xyz");
    expect(item.listId).toBe(LIST_CURRENT);
    expect(item.status).toBe("live");

    expect(doc.getItemJson("does-not-exist")).toBeUndefined();

    const list = JSON.parse(doc.getListMetaJson(LIST_CURRENT)!);
    expect(list.id).toBe(LIST_CURRENT);
    expect(list.name).toBe("Current");

    expect(doc.getListMetaJson("nope")).toBeUndefined();
  });
});
