// End-to-end: real `airday-server` process, two wasm SyncEngines,
// real msgpack over a real WebSocket. Exercises the server-orchestrated
// snapshot path: device A crosses the (test-tuned) snapshot threshold,
// server requests a snapshot, A uploads it, device B then bootstraps
// from that snapshot blob rather than replaying every op.
//
// Why this test runs a real server: the Rust integration test in
// `server/tests/sync.rs` already covers the snapshot state machine
// from inside the server crate. This test is here to prove the *wasm
// surface* + real WS transport behave the same — catching e.g. a
// regression in `popOutbox()` ordering or `handleServerBytes()` that
// the pure-Rust test can't see.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { Database } from "bun:sqlite";
import { decode, encode } from "@msgpack/msgpack";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  Dek,
  deriveLogin,
  Doc,
  SyncEngine,
  wrapDek,
} from "../wasm/airday_core_web.js";
import { SyncBridge } from "../src/sync-bridge.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const SERVER_BIN = join(REPO_ROOT, "target/debug/airday-server");

const LIST_MAIN = "main";
const SNAPSHOT_THRESHOLD = 5;
// Weak Argon2 keeps signup ~ms; matches `server/tests/sync.rs::weak_params`.
const KDF = { m_kib: 8, t: 1, p: 1 } as const;

interface ServerHandle {
  baseUrl: string;
  wsUrl: string;
  dbPath: string;
  proc: Subprocess;
  workDir: string;
}

async function ensureBuilt(): Promise<void> {
  const proc = spawn(["cargo", "build", "-p", "airday-server"], {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`cargo build airday-server failed (exit ${code})`);
}

async function startServer(): Promise<ServerHandle> {
  const workDir = mkdtempSync(join(tmpdir(), "airday-e2e-"));
  const dbPath = join(workDir, "airday.sqlite");
  const proc = spawn([SERVER_BIN, "--bind", "127.0.0.1:0", "--db", dbPath], {
    cwd: workDir,
    env: {
      ...process.env,
      AIRDAY_SNAPSHOT_THRESHOLD_BLOBS: String(SNAPSHOT_THRESHOLD),
      AIRDAY_SECURE_COOKIES: "false",
      AIRDAY_LOG_LEVEL: "info",
      // tracing-subscriber emits ANSI even on piped output; off so
      // `readUntilListening`'s regex sees clean bytes.
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const addr = await readUntilListening(proc);
  return {
    baseUrl: `http://${addr}`,
    wsUrl: `ws://${addr}`,
    dbPath,
    proc,
    workDir,
  };
}

// `airday-server` logs `airday-server listening addr=…` via tracing;
// we tee both streams to our own stderr so the test output stays
// useful when something blows up mid-handshake. We keep both
// consumers running for the life of the process so the server's
// stdio doesn't back-pressure — but the first match resolves.
async function readUntilListening(proc: Subprocess): Promise<string> {
  const re = /addr=(\d+\.\d+\.\d+\.\d+:\d+)/;
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const decoder = new TextDecoder();
  let buf = "";
  let resolved = false;

  return new Promise((resolveOk, rejectOk) => {
    const consume = async (
      stream: ReadableStream<Uint8Array> | null,
    ): Promise<void> => {
      if (!stream) return;
      try {
        // Bun's ReadableStream is async-iterable; DOM types don't say so.
        for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
          const text = decoder.decode(chunk);
          process.stderr.write(text);
          if (resolved) continue;
          buf += stripAnsi(text);
          const m = buf.match(re);
          if (m) {
            resolved = true;
            resolveOk(m[1]);
          }
        }
      } catch {
        // Stream ended; the Promise.all .then() below handles the
        // "exited without listening" case.
      }
    };
    Promise.all([
      consume(proc.stderr as unknown as ReadableStream<Uint8Array> | null),
      consume(proc.stdout as unknown as ReadableStream<Uint8Array> | null),
    ]).then(() => {
      if (!resolved) {
        rejectOk(new Error("server exited before logging listen addr"));
      }
    });
  });
}

async function stopServer(s: ServerHandle): Promise<void> {
  s.proc.kill();
  await s.proc.exited;
  rmSync(s.workDir, { recursive: true, force: true });
}

interface Account {
  accountId: string;
  deviceToken: string;
}

async function signup(s: ServerHandle, dekForWrap: Dek): Promise<Account> {
  const masterSalt = crypto.getRandomValues(new Uint8Array(16));
  const derived = deriveLogin(
    "test-password",
    masterSalt,
    KDF.m_kib,
    KDF.t,
    KDF.p,
  );
  const wrapped = wrapDek(derived.kek, dekForWrap);
  const email = `e2e-${crypto.randomUUID()}@example.com`;
  const body = encode({
    email,
    master_salt: masterSalt,
    kdf_params: KDF,
    auth_secret: derived.authSecret,
    wrapped_dek: wrapped.ciphertext,
    wrapped_dek_nonce: wrapped.nonce,
    recovery: null,
    device_name: "device-a",
  });
  const resp = await fetch(`${s.baseUrl}/api/account/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/msgpack" },
    body,
  });
  if (!resp.ok) {
    throw new Error(`signup failed: ${resp.status} ${await resp.text()}`);
  }
  const decoded = decode(new Uint8Array(await resp.arrayBuffer())) as {
    account_id: string;
    device_token: string;
    device_id: string;
  };
  return { accountId: decoded.account_id, deviceToken: decoded.device_token };
}

async function registerDevice(
  s: ServerHandle,
  primaryToken: string,
  name: string,
): Promise<string> {
  const body = encode({ name });
  const resp = await fetch(`${s.baseUrl}/api/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/msgpack",
      Authorization: `Bearer ${primaryToken}`,
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(`register device failed: ${resp.status} ${await resp.text()}`);
  }
  const decoded = decode(new Uint8Array(await resp.arrayBuffer())) as {
    device_token: string;
  };
  return decoded.device_token;
}

// Construct a bridge with a bearer-header socket factory and resolve
// once it's seen "online" at least once. Tests then drive mutations
// and let the bridge's own onmessage pump push outbox bytes; explicit
// `pumpOutbox()` calls cover the case where local mutations happen
// between server frames.
function attachEngine(
  s: ServerHandle,
  token: string,
  engine: SyncEngine,
): Promise<SyncBridge> {
  return new Promise((resolveOk) => {
    let resolved = false;
    const bridge = new SyncBridge({
      engine,
      // Bun extends `new WebSocket` with an options object that
      // supports `headers`; the stdlib type sig only knows about
      // subprotocols.
      socketFactory: () =>
        new WebSocket(`${s.wsUrl}/api/sync`, {
          headers: { Authorization: `Bearer ${token}` },
        } as unknown as string[]),
      onChange: (kind) => {
        if (kind === "online" && !resolved) {
          resolved = true;
          resolveOk(bridge);
        }
      },
      reconnectDelayMs: 50,
    });
    bridge.start();
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
}

function snapshotCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.query("SELECT COUNT(*) as n FROM snapshots").get() as {
      n: number;
    };
    return row.n;
  } finally {
    db.close();
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("e2e snapshot + second-device bootstrap", () => {
  let server: ServerHandle;

  beforeAll(async () => {
    await ensureBuilt();
    server = await startServer();
  }, 180_000);

  afterAll(async () => {
    if (server) await stopServer(server);
  });

  test("device B converges with device A after snapshot path", async () => {
    const seedDek = Dek.generate();
    const account = await signup(server, seedDek.clone());

    const engineA = new SyncEngine(
      Doc.create(),
      seedDek.clone(),
      0n,
      "device-a",
      "0.0.0",
    );
    const bridgeA = await attachEngine(server, account.deviceToken, engineA);

    // Cross the threshold (5) by a margin so we get a SnapshotRequest
    // without ambiguity about off-by-one in the eligibility check.
    // Push one item at a time and wait for the server ack between
    // each — the engine bundles co-pending mutations into a single op
    // blob (= one server-assigned op id), so a tight batch wouldn't
    // accumulate enough op ids to cross the threshold.
    const ITEMS = SNAPSHOT_THRESHOLD + 3;
    for (let i = 0; i < ITEMS; i++) {
      engineA.addItem(LIST_MAIN, `item ${i}`);
      engineA.flush();
      bridgeA.pumpOutbox();
      await waitFor(
        () => engineA.highestSeenOpId() >= BigInt(i + 1),
        `op ${i + 1} acked by server`,
      );
    }

    // The snapshot row landing in sqlite is the cleanest "the whole
    // server-orchestrated path completed" signal — server received
    // PushSnapshot from the engine and committed it.
    await waitFor(() => snapshotCount(server.dbPath) > 0, "snapshot row", 10_000);

    // Device B comes online fresh. Its `last_acked_op_id=0` is below
    // the server's snapshot floor, so the server replies with
    // `SnapshotRequired` rather than streaming every op. The engine
    // transparently fetches the snapshot, loads it, and resumes.
    const tokenB = await registerDevice(server, account.deviceToken, "device-b");
    const engineB = new SyncEngine(
      Doc.empty(),
      seedDek.clone(),
      0n,
      "device-b",
      "0.0.0",
    );
    const bridgeB = await attachEngine(server, tokenB, engineB);

    await waitFor(
      () => hex(engineA.fingerprint()) === hex(engineB.fingerprint()),
      "fingerprint convergence",
      10_000,
    );

    expect(hex(engineB.fingerprint())).toBe(hex(engineA.fingerprint()));

    const itemsB = JSON.parse(
      engineB.itemsInListJson(LIST_MAIN, false),
    ) as Array<{ text: string }>;
    expect(itemsB.map((i) => i.text).sort()).toEqual(
      Array.from({ length: ITEMS }, (_, i) => `item ${i}`).sort(),
    );

    bridgeA.stop();
    bridgeB.stop();
  }, 30_000);
});
