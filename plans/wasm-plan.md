# Status — Operation Phoenix

Handoff notes for the next conversation. Not a public roadmap.

## Shipped

- **Sync wire types** in `crates/protocol/src/sync.rs` — `Hello`/`HelloAck`/`HelloRejected`, `EncryptedBlob`, `StoredOp`, internally-tagged `ClientFrame`/`ServerFrame` enums.
- **Server WS endpoint** at `/api/sync` — bearer auth on upgrade, version handshake, push/pull/ack with monotonic id assignment, peer broadcast (`SyncSessions` registry, RAII subscriptions, bounded mpsc, `tokio::select!` in the session loop). 7 sync integration tests.
- **`core/src/doc.rs`** — `Doc` wrapping `LoroDoc`. Mutations: `add_item`, `edit_item_text`, `move_item`, `set_item_status`, `delete_binned`, `empty_bin`, `add_list`, `rename_list`, `delete_list`. Built-ins `current` + `holding` seeded on `Doc::new()`. `pending_export(dek)` / `apply_remote(dek, blob)` op stream; `last_pushed_vv` tracks the frontier. `save()` / `load()` round-trip via msgpack envelope. `fingerprint()` for convergence assertions. 14 unit tests including two-replica convergence.
- **CLI Session runtime** (`cli/src/sync.rs`) — `Session::open(offline)` with 2s connect timeout + offline fallback, `flush()` (save → push → ack), `Session::open_with_profile` for tests. `--offline` global flag + `AIRDAY_OFFLINE=1`.
- **CLI commands** — `add` (with stdin), `ls`, `done`, `bin` (verb + namespace via `external_subcommand`), `restore`, `mv`, `edit`, `lists` (default + `add`/`rename`/`rm`), `bin show/empty/rm`, `status`. ID prefix resolution with disambiguation. `--json` on read commands. `last_sync_at` plumbed through `DeviceConfig` and bumped on online flushes.
- **CLI integration tests** — push/pull/ack round-trip, offline short-circuit, two-device pull (B observes A's items via the broadcast→pull integration).

**Test counts:** 46 across the workspace (22 core, 7 cli unit, 3 cli smoke, 14 server). Clippy clean.

## Next slice — Bun-first core wasm wrapper

User wants to start the web app foundation. Plan agreed:

### Layout

```
core/web/                 NEW Rust crate, cdylib, wasm-bindgen wrappers
  src/lib.rs              #[wasm_bindgen] facade over airday-core (Doc, crypto, EncryptedBlob)
  Cargo.toml              [lib] crate-type = ["cdylib"]; depends on airday-core path
js/core/                  NEW TS package consuming wasm-pack output
  src/index.ts            re-exports
  src/storage/adapter.ts  StorageAdapter interface (getDoc/putDoc/getDevice/putDevice/clear)
  src/storage/mem.ts      Map-backed (headless tests)
  src/storage/file.ts     Bun-only, mirrors CLI on-disk layout
  src/storage/idb.ts      browser, later
js/core/test/             Bun tests
```

- **Storage pattern is from `js-legacy/core/src/storage/`** — `StorageAdapter` abstract + `AirdayMemStorage` + `AirdayIDBStorage`. (Cooee uses `loro-crdt` from npm directly with no custom wasm wrapper, so it's not a model here.)
- **Build:** `wasm-pack build core/web --target nodejs --out-dir ../../js/core/wasm` for Bun. Browser later switches to `--target web` or `bundler`.
- **Wasm exports for slice 1:** `Doc` (mutations + save/load + fingerprint + pending_export/apply_remote), `Dek` (generate, hex round-trip), `EncryptedBlob`. *Skip for slice 1:* sync state machine, password derivation flow.
- **First commit target:** `Doc → addItem → save → MemStorage.put → MemStorage.get → load → fingerprint matches`. Plus `BunFileStorage` for headless smoke against the real server.

## Future / out of slice 1

- **Argon2id in a worker** for the eventual password-derivation flow. Bun's `Worker` and browser's `Web Worker` are the same shape. Run our existing Rust `argon2` crate in wasm in the worker — competitive with `hash-wasm`/`argon2-browser`. Don't add a JS dep unless benchmarks force it.
- **Sync engine port.** Currently `Session` is tokio-based and won't compile to wasm (`tokio-tungstenite` is not portable). Two options: (a) lift the protocol state machine into Rust as transport-agnostic, JS owns the WebSocket; (b) keep state machine in JS, wasm only handles the crypto + Loro layer. Decide after slice 1.
- **DEK lifetime in browser.** Plain-file storage in the CLI is the sprint-1 stopgap. Browser path: in-memory only by default, re-derived from password each session. Web Crypto wrapped-key story for "stay logged in" comes later.
- **Snapshot orchestration** — server's threshold check + `SnapshotRequest`/`PushSnapshot`/compaction. Required before the dataset gets old.
- **E2E test matrix from `spec/testing.md`** — currently covered: signup→add→re-login→items intact (via two-device test), two clients live convergence (via broadcast test). Missing: offline-mutate-then-sync, both-offline-then-converge, snapshot-bootstrap-fresh-device, recovery flow round-trip.
- **Loro shallow snapshots** when `loro.bin` gets uncomfortable. One-line change to `Doc::save`.
- **In-memory `HashMap<id, idx>` lookup cache** when `find_item` scan becomes a profiler hit. Rebuild on `Doc::load`, mutate on each op. ~30 LOC. Don't pre-optimize.

## Decisions made along the way (worth not re-litigating)

- **Server is an "opaque blob relay"** — never reads op contents. Pinned in `spec/architecture.md`.
- **MessagePack everywhere** (HTTP + WS). `rmp-serde` + `serde_bytes` for byte fields.
- **Internally-tagged enums** for client/server frames so the discriminator travels in-band.
- **`SyncSessions` (was `SyncHub`)** — registry of live WS sessions, fan-out via per-session bounded mpsc carrying pre-encoded msgpack bytes. Slow/closed receivers dropped from the registry; client reconnects + pulls.
- **`last_pushed_vv`** in `Doc` is the frontier. After a successful push *or* a successful pull-and-apply, advance it. Ensures we never re-push peer-applied ops.
- **`Doc::new()` does *not* mark seeded built-ins as pushed** — they travel as the first push, so peers joining via op stream see them.
- **`Doc::empty()` for device-2 bootstrap** — pulls from op id 0, applies device-1's history, converges. Snapshot bootstrap is a future slice.
- **CLI is one-shot per command.** No daemon. Each invocation does open → mutate → flush → close. Future TUI may hold WS open; deferred.
- **Don't split hot/cold doc storage.** Loro shallow snapshots address the same pain without breaking the unified-causality model.
