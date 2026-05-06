// Boot-path perf rig for the snapshot+WAL adapter.
//
// Numbers print to stdout; Bun's test runner doesn't fail on
// `console.log`, so this file double-duties as a benchmark we can
// re-run after each tweak to the replay path. The thresholds are
// "shouldn't take ages" — they're not tight perf targets, they're
// canaries for regressions like accidental O(n²) work.

import { describe, expect, test } from "bun:test";

import {
  Dek,
  Doc,
  EncryptedBlob,
  SyncEngine,
} from "../wasm/airday_core_web.js";
import { MemWalStorage } from "../src/storage/mem-wal.ts";

interface Phase {
  name: string;
  ms: number;
}

function ms(): number {
  return performance.now();
}

async function fillWal(
  store: MemWalStorage,
  engine: SyncEngine,
  startCursor: Uint8Array,
  count: number,
): Promise<Uint8Array> {
  let cursor = startCursor;
  for (let i = 0; i < count; i++) {
    engine.addItem("main", `item ${i}`);
    const updates = engine.exportUpdatesAfter(cursor);
    if (updates.length > 0) {
      await store.appendWal(updates);
      cursor = engine.oplogVvBytes();
    }
  }
  return cursor;
}

async function timeBoot(store: MemWalStorage, dek: Dek): Promise<{
  totalMs: number;
  phases: Phase[];
  doc: Doc;
}> {
  const phases: Phase[] = [];
  const t0 = ms();

  const replay = await store.loadForReplay();
  const t1 = ms();
  phases.push({ name: "loadForReplay (decrypt all)", ms: t1 - t0 });

  const doc = replay.snapshot ? Doc.load(replay.snapshot) : Doc.empty();
  const t2 = ms();
  phases.push({ name: "Doc.load(snapshot)", ms: t2 - t1 });

  for (const entry of replay.walEntries) {
    doc.importWalUpdates(entry.plaintext);
  }
  const t3 = ms();
  phases.push({
    name: `importWalUpdates × ${replay.walEntries.length}`,
    ms: t3 - t2,
  });

  return { totalMs: t3 - t0, phases, doc };
}

function printPerf(scenario: string, run: { totalMs: number; phases: Phase[] }): void {
  // eslint-disable-next-line no-console
  console.log(`\n[wal-perf] ${scenario}`);
  for (const p of run.phases) {
    // eslint-disable-next-line no-console
    console.log(`  ${p.name.padEnd(40)} ${p.ms.toFixed(2)}ms`);
  }
  // eslint-disable-next-line no-console
  console.log(`  ${"TOTAL".padEnd(40)} ${run.totalMs.toFixed(2)}ms`);
}

describe("boot-path perf", () => {
  test("snapshot + 999 trailing WAL rows replays in well under a second", async () => {
    const dek = Dek.generate();
    const store = new MemWalStorage(dek.clone(), EncryptedBlob);
    await store.loadForReplay();
    const seedEngine = new SyncEngine(
      Doc.create(),
      dek.clone(),
      0n,
      "perf",
      "0.0.0",
    );
    let cursor = seedEngine.oplogVvBytes();

    // 200 commits → snapshot → 999 trailing WAL rows. The 999 is the
    // worst case under SNAPSHOT_THRESHOLD=1000 — one short of the
    // next snapshot.
    cursor = await fillWal(store, seedEngine, cursor, 200);
    await store.commitSnapshot(seedEngine.save(), store.highestWalSeq());
    cursor = await fillWal(store, seedEngine, cursor, 999);

    const reborn = store.forkForReboot();
    const run = await timeBoot(reborn, dek);
    printPerf("snapshot + 999 trailing WAL rows", run);
    expect(run.totalMs).toBeLessThan(1000);
  });

  test("pure WAL replay (no snapshot) costs roughly linearly with row count", async () => {
    const dek = Dek.generate();
    const store = new MemWalStorage(dek.clone(), EncryptedBlob);
    await store.loadForReplay();
    const seedEngine = new SyncEngine(
      Doc.create(),
      dek.clone(),
      0n,
      "perf",
      "0.0.0",
    );
    const cursor = seedEngine.oplogVvBytes();
    await fillWal(store, seedEngine, cursor, 500);

    const reborn = store.forkForReboot();
    const run = await timeBoot(reborn, dek);
    printPerf("no snapshot, 500 WAL rows", run);
    expect(run.totalMs).toBeLessThan(1000);
  });

  test("snapshot only, empty WAL is essentially free", async () => {
    const dek = Dek.generate();
    const store = new MemWalStorage(dek.clone(), EncryptedBlob);
    await store.loadForReplay();
    const seedEngine = new SyncEngine(
      Doc.create(),
      dek.clone(),
      0n,
      "perf",
      "0.0.0",
    );
    let cursor = seedEngine.oplogVvBytes();
    cursor = await fillWal(store, seedEngine, cursor, 2000);
    await store.commitSnapshot(seedEngine.save(), store.highestWalSeq());

    const reborn = store.forkForReboot();
    const run = await timeBoot(reborn, dek);
    printPerf("snapshot of 2000 ops, empty WAL", run);
    expect(run.totalMs).toBeLessThan(200);
  });
});
