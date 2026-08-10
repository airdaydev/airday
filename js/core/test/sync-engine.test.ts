// FFI smoke for the wasm SyncEngine surface.
//
// The deep state-machine coverage lives in `core/src/sync.rs` Rust
// tests; this file only verifies the wasm-bindgen contract holds:
// constructor consumes Doc/Dek, transport callbacks queue bytes,
// events come out as flat objects with the documented shape, doc
// mutations through the engine are observable, and a save/load round
// trip reconstructs an engine without losing state.
//
// "Stub WebSocket" here is the test itself: it pushes connect, drains
// the outbox, and asserts what the engine produced. A full protocol
// round trip would need a JS-side msgpack encoder we don't need yet.

import { describe, expect, test } from "bun:test";

import { Dek, Doc, SyncEngine } from "../wasm/airday_core_web.js";
import type { EngineStorage } from "../wasm/airday_core_web.js";
import { MemEngineStorage } from "./mem-engine-storage.ts";

const LIST_MAIN = "inbox";

function memStorage(): EngineStorage {
  return new MemEngineStorage() as unknown as EngineStorage;
}

/** Drain the engine's AppEvent queue into plain objects — the wasm
 *  getters are only readable while the event is alive. */
function drainAppEvents(eng: SyncEngine): Array<{
  kind: string;
  id: string;
  defaultView?: string;
  inboxView?: string;
}> {
  const out = [];
  while (true) {
    const ev = eng.popAppEvent();
    if (!ev) break;
    out.push({
      kind: ev.kind,
      id: ev.id,
      defaultView: ev.defaultView,
      inboxView: ev.inboxView,
    });
  }
  return out;
}

function newEngine(): SyncEngine {
  // Doc.create() builds a fresh doc with no commits (no seeded user
  // lists). Mutations through the engine are what put it in a
  // pending state.
  return new SyncEngine(
    Doc.create(),
    "00000000-0000-0000-0000-000000000000",
    Dek.generate(),
    0n,
    "test",
    "0.0.0",
    memStorage(),
  );
}

describe("SyncEngine construction", () => {
  test("starts offline, non-idle, with a fresh frontier", () => {
    const eng = newEngine();
    expect(eng.isOnline()).toBe(false);
    expect(eng.isIdle()).toBe(false);
    expect(eng.lastContiguousSeq()).toBe(0n);
  });
});

describe("transport callbacks", () => {
  test("handleConnected queues Hello and emits online event", () => {
    const eng = newEngine();
    eng.handleConnected();

    expect(eng.isOnline()).toBe(true);

    const frame = eng.popOutbox();
    expect(frame).toBeInstanceOf(Uint8Array);
    expect(frame!.length).toBeGreaterThan(0);
    // Outbox is single-pop — second drain is empty.
    expect(eng.popOutbox()).toBeUndefined();

    const evt = eng.popEvent();
    expect(evt).toBeDefined();
    expect(evt!.kind).toBe("connStateChanged");
    expect(evt!.online).toBe(true);
    expect(evt!.seq).toBeUndefined();
    expect(evt!.message).toBeUndefined();
    expect(eng.popEvent()).toBeUndefined();
  });

  test("handleDisconnected from Hello clears outbox and emits offline", () => {
    const eng = newEngine();
    eng.handleConnected();
    eng.popOutbox(); // discard Hello
    eng.popEvent(); // discard online event

    eng.handleDisconnected();
    expect(eng.isOnline()).toBe(false);
    expect(eng.popOutbox()).toBeUndefined();

    const evt = eng.popEvent();
    expect(evt!.kind).toBe("connStateChanged");
    expect(evt!.online).toBe(false);
  });

  test("handleServerBytes while disconnected surfaces an error event", () => {
    const eng = newEngine();
    eng.handleServerBytes(new Uint8Array([0x00, 0x01]));
    const evt = eng.popEvent();
    expect(evt!.kind).toBe("error");
    expect(typeof evt!.message).toBe("string");
    expect(evt!.message!.length).toBeGreaterThan(0);
  });

  test("handleTimeout in Hello produces a handshake error", () => {
    const eng = newEngine();
    eng.handleConnected();
    eng.popOutbox();
    eng.popEvent();

    eng.handleTimeout();
    const evt = eng.popEvent();
    expect(evt!.kind).toBe("error");
    expect(evt!.message).toContain("timed out");
  });
});

describe("doc passthrough", () => {
  test("addItem through the engine is visible via itemsInListJson", () => {
    const eng = newEngine();
    const id = eng.addItem(LIST_MAIN, "buy milk");
    const items = JSON.parse(
      eng.itemsInListJson(LIST_MAIN, false),
    ) as Array<{ id: string; text: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(id);
    expect(items[0].text).toBe("buy milk");
  });

  test("allListsJson on a fresh engine is empty; main is not a ListMeta", () => {
    const eng = newEngine();
    const lists = JSON.parse(eng.allListsJson()) as Array<{
      id: string;
      name: string;
    }>;
    // Per spec/data-model.md: `main` is a reserved id, not a
    // MovableList entry, and there are no seeded user lists.
    expect(lists).toHaveLength(0);
    expect(lists.some((l) => l.id === LIST_MAIN)).toBe(false);
  });

  test("hasUncapturedOps reflects uncaptured mutations", () => {
    const eng = newEngine();
    // Fresh doc has no commits → nothing uncaptured.
    expect(eng.hasUncapturedOps()).toBe(false);
    eng.addItem(LIST_MAIN, "later");
    expect(eng.hasUncapturedOps()).toBe(true);
  });

  test("flush before connect is a queued no-op (no outbox bytes)", () => {
    const eng = newEngine();
    eng.addItem(LIST_MAIN, "later");
    eng.flush();
    expect(eng.popOutbox()).toBeUndefined();
  });

  test("setDefaultView surfaces on the snapshot and as an event", () => {
    const eng = newEngine();
    const listId = eng.addList("Work");
    drainAppEvents(eng);

    eng.setDefaultView(listId, "board:nodone");
    const events = drainAppEvents(eng);
    const changed = events.find((e) => e.kind === "listDefaultViewChanged");
    expect(changed?.id).toBe(listId);
    expect(changed?.defaultView).toBe("board:nodone");

    const snap = JSON.parse(eng.workspaceSnapshotJson()) as {
      settings: { inboxView?: string };
      lists: Array<{ id: string; defaultView?: string }>;
    };
    expect(snap.lists.find((l) => l.id === listId)?.defaultView).toBe(
      "board:nodone",
    );

    // Clearing drops the key rather than persisting a "none" value.
    eng.setDefaultView(listId, "");
    expect(drainAppEvents(eng).at(-1)?.defaultView).toBeUndefined();
    const cleared = JSON.parse(eng.workspaceSnapshotJson()) as {
      lists: Array<{ id: string; defaultView?: string }>;
    };
    expect(cleared.lists.find((l) => l.id === listId)?.defaultView).toBeUndefined();
  });

  test("inbox's default view rides on settings, not a ListMeta row", () => {
    const eng = newEngine();
    drainAppEvents(eng);

    // The reserved list has no ListMeta row, so its default lands in the
    // doc-level settings map and reports via settingsChanged.
    eng.setDefaultView(LIST_MAIN, "board");
    const settingsEvent = drainAppEvents(eng).find(
      (e) => e.kind === "settingsChanged",
    );
    expect(settingsEvent?.inboxView).toBe("board");

    const snap = JSON.parse(eng.workspaceSnapshotJson()) as {
      settings: { inboxView?: string };
      lists: Array<{ id: string }>;
    };
    expect(snap.settings.inboxView).toBe("board");
    expect(snap.lists.some((l) => l.id === LIST_MAIN)).toBe(false);
  });

  test("setDefaultView rejects a view it can't encode", () => {
    const eng = newEngine();
    const listId = eng.addList("Work");
    // A typo must surface rather than silently clearing the default.
    expect(() => eng.setDefaultView(listId, "hologram")).toThrow();
  });
});

describe("save / load round trip", () => {
  test("engine.save() → Doc.load() → new SyncEngine preserves fingerprint", () => {
    const a = newEngine();
    a.addItem(LIST_MAIN, "persist me");
    const fingerprintBefore = a.fingerprint();
    const snapshot = a.save();

    // Same DEK so the reconstructed engine could in principle decrypt
    // remote ops; not exercised here, just locking down the API.
    const dek = Dek.generate();
    const restored = new SyncEngine(
      Doc.load(snapshot),
      "00000000-0000-0000-0000-000000000000",
      dek,
      0n,
      "test",
      "0.0.0",
      memStorage(),
    );
    const fingerprintAfter = restored.fingerprint();

    expect(fingerprintAfter).toEqual(fingerprintBefore);
    const items = JSON.parse(
      restored.itemsInListJson(LIST_MAIN, false),
    ) as Array<{ text: string }>;
    expect(items.find((i) => i.text === "persist me")).toBeDefined();
  });
});
