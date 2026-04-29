# Sync Engine — Slice 4 execution plan

Companion to `sync-engine.md`. Slice 4 was three bullets in the parent
doc ("IDB adapter + first web client"); this expands it into stageable
work. Decisions taken since the parent doc are recorded inline.

## Decisions taken since `sync-engine.md`

- **OPFS, not IndexedDB.** Loro's persistence shape is "write a blob,
  read it back" — IDB object stores / cursors / transactions are
  overkill for that. OPFS via `navigator.storage.getDirectory()` is
  literally `read()` / `write(buf)`, and matches `storage/file.ts` on
  native. The storage adapter stays uniform across runtimes.
- **Vite + Solid + TS** for `js/web/`. Solid's fine-grained
  reactivity matches Loro change events well: per-item updates, no
  list diffing. Vite gives us the `--target bundler` wasm-pack output
  the parent doc already called out.
- **Drag-and-drop via `@primavera-ui/components/dnd`.** Custom
  element + virtualization + multi-select + optimistic preview already
  solved. Linked from sibling repo `../primavera-ui` via Bun `link:`
  while pre-1.0. Workflow note: needs `bun run build` once in sibling
  before `js/web` can resolve it.
- **Nav shape.** Per-list (Live items in `MovableList` order) +
  cross-list "Done" (by `done_at` desc) + cross-list "Bin" (by
  `binned_at` desc). No tab/filter chips; the nav *is* the filter.
- **Read-side helpers live on `Doc`.** Engine = transport state, Doc
  = content. Four helpers needed: `lists()`, `live_item_ids(list_id)`,
  `done_item_ids()`, `binned_item_ids()`.
- **Scaling for big done/bin.** Not a slice 4 concern. Ship with an
  in-memory bucketed index built from the helpers above; revisit if
  telemetry shows pain. TTL-purge of old Done is a one-line follow-up
  if needed (`empty_bin` shape applied to Done past a cutoff).

## Wasm targets

`bun run build:wasm` currently outputs `--target nodejs` for Bun tests
on `js/core`. Add a parallel script:

```
bun run build:wasm:web
  → wasm-pack build core/web --target bundler --out-dir ../../js/core/wasm-web
```

`js/core/package.json` grows conditional exports so `js/web` resolves
the bundler build automatically and Bun tests keep using nodejs:

```jsonc
"./wasm": {
  "browser": "./wasm-web/airday_core_web.js",
  "default": "./wasm/airday_core_web.js"
}
```

## Solid wrapper for `<primavera-dnd>`

The lib hands the renderer a raw `HTMLElement`. Solid plugs in via
`render()` returning a dispose fn — exactly the cleanup contract the
lib wants. Children take *only* the key; the row component reads its
data reactively from the store, so edits/status flips re-render
without touching the source.

```tsx
import { onMount } from "solid-js";
import { render } from "solid-js/web";
import { register, type DndSource } from "@primavera-ui/components/dnd";

register();

export function Dnd<T>(props: {
  source: DndSource<T>;
  itemHeight?: number;
  children: (key: string | number) => JSX.Element;
}) {
  let el!: HTMLElement & { setSource(s: any): void; setRenderer(r: any): void };
  onMount(() => {
    el.setSource(props.source);
    el.setRenderer({
      mount: (key, _item, container) =>
        render(() => props.children(key), container),
    });
  });
  return <primavera-dnd ref={el} item-height={String(props.itemHeight ?? 40)} />;
}
```

## Stages

Each stage produces a mergeable artefact with a clear DoD. Order
prioritises visible progress; auth is in the middle, not first, so
the UI shape stabilises before we plumb the network.

### Stage 1 — Scaffolding

**Goal:** dev server boots, primavera-dnd renders mock data.

- New Bun workspace package `js/web/` (Vite + Solid + TS), with
  `dev` / `build` / `typecheck` / `lint` scripts.
- Add `build:wasm:web` script + conditional exports as above.
- Link `@primavera-ui/components` from `../primavera-ui` via `link:`;
  document the sibling-build prereq in `js/web/README.md` (the only
  README we add this slice).
- `Dnd.tsx` Solid wrapper as above.
- App shell: side nav with hardcoded list names + Done + Bin; main
  pane shows a `<Dnd>` with mock items so drag works end-to-end.

**DoD:** `bun --cwd js/web dev` serves; mock items drag and reorder.

### Stage 2 — Doc view helpers (Rust + wasm)

**Goal:** the four read-side helpers are callable from JS.

- Rust additions on `Doc`: `lists()`, `live_item_ids(list_id)`,
  `done_item_ids()`, `binned_item_ids()`. Plus `get_item(id)` and
  `get_list_meta(id)` if not already exposed.
- Sorts: MovableList order for `live_item_ids`; `done_at` desc for
  `done_item_ids`; `binned_at` desc for `binned_item_ids`.
- Rust unit tests: empty doc, single item per status, mixed status,
  multiple lists, deleted list (orphaned items reassigned).
- wasm-bindgen surface in `core/web` for each helper.
- Bun test in `js/core/test/views.test.ts` for the JS surface.

**DoD:** `cargo test` and `bun run test:core:js` green; helpers
return the right ids in the right order.

### Stage 3 — Working app, in-memory only

**Goal:** functional offline todo app — add / done / bin / move /
empty-bin all work in memory. No persistence, no server.

- Solid store keyed by item id, mirrors Doc state. Subscribe to Loro
  doc events; on each event, derive view ids via the helpers and
  patch the store.
- Per-view rendering wires a `DndSource` whose `getOrder` returns the
  ids from the relevant helper. Solid effect re-calls
  `source.syncOrder()` when the underlying ids change.
- Mutations dispatched through the engine: `add_item`,
  `set_item_status`, `move_item`, `empty_bin`, `delete_binned`.
- `source.onChange` translates `move` ops into `move_item` calls.
  `insert` / `remove` / `update` aren't driven by drag in this UI;
  they flow back from Loro into the source via `syncOrder()`.

**DoD:** add an item, mark done, see it move to Done view; bin an
item, see it move to Bin; drag-reorder within a list. Reload loses
state (intentional this stage).

### Stage 4 — Auth + sync connect

**Goal:** real WebSocket sync with the server. CLI + browser on the
same account see each other's changes.

- Login form: email + password → HTTP `/auth/login` returning session
  token + DEK-wrap material.
- Password → KEK via Argon2id on the main thread (worker is out per
  parent doc). UI shows a "logging in…" spinner for the ~500ms hit.
- KEK unwraps DEK; DEK held in memory for the session only.
- WebSocket connect with session token on the URL — browsers can't
  set Authorization on `WebSocket`. This is **not** the proper
  ticket-exchange pattern (`sync-engine.md` flags that as out of
  scope); we accept token-on-URL for slice 4 and revisit auth when
  iOS/Android land.
- Engine wired via the slice-3 wasm-bindgen surface; pop-event /
  pop-outbox loop drives WS sends and Solid store updates.
- Reconnect: hardcoded fixed-delay retry on disconnect. No backoff,
  no visibility/online detection — out of scope per parent doc.

**DoD:** add an item in the browser, see it in the CLI. Add in the
CLI, see it in the browser. Both within ~1s on local network.

### Stage 5 — OPFS persistence

**Goal:** reload the page, doc state survives.

- `js/core/src/storage/opfs.ts` implementing the existing storage
  adapter trait (mirror of `file.ts` shape).
- Snapshot bytes encrypted with DEK before write (`EncryptedBlob`);
  decrypted on read. Same primitive the CLI uses.
- Save policy: debounced 500ms after last Loro change, plus on
  `visibilitychange → hidden`.
- Async OPFS on main thread (no sync handles, no worker). Worker move
  tracked as out-of-scope.
- On boot: if OPFS has a doc, load it before WS connect; sync engine
  picks up from there. If not, wait for initial pull.

**DoD:** add items, refresh, items still there. Network offline,
items still loadable from OPFS; mutations queue and flush on
reconnect.

### Stage 6 — Smoke + cleanup

- Manual test plan in this doc covering: login, add, done, bin, move,
  reload, two-tab sync, CLI↔browser sync. (Playwright in a later
  slice; not worth the harness setup yet.)
- `cargo clippy` / `bun run typecheck` green across the workspace.
- `sync-engine.md` slice 4 bullet updated to reference this doc and
  note completion.

## Manual smoke

Standing-up checklist:

```sh
bun install                                            # workspace deps + primavera-ui link
cd ../primavera-ui/packages/components && bun run build   # one-shot prereq, see js/web/README.md
cd -  &&  bun run build:wasm  &&  bun run build:wasm:web  # nodejs + bundler wasm
bun run server -- --db local/airday.db                 # one terminal
bun --cwd js/web dev                                   # another — http://localhost:5173
```

Drive each path manually:

- **Signup → app shell.** Click `Need an account? Sign up`, enter
  email + password (≥10 chars). After ~150ms the form swaps to the
  workspace with `Current` and `Holding` lists.
- **Add / done / bin / restore.** In `Current`: type → `Add`. Tick
  the row → it disappears (lands in `Done`). Hit `Bin` → it lands
  in `Bin`. Open `Bin`, click `Restore` → back in the originating
  list as live.
- **Drag-reorder.** Add three items in `Current`, drag the bottom
  one to the top. Order persists.
- **Reload.** Refresh the tab; you'll have to log in again (DEK is
  in-memory only). After login, items / lists are intact —
  `OpfsStorage.getDoc` decrypts the cached snapshot before the WS
  catch-up runs.
- **Two-tab sync.** Open a second tab, log in as the same account.
  Add an item in either tab; it appears in the other within a
  second.
- **CLI ↔ browser sync.** `bun run cli -- signup` (or `login`) on
  the same server / account and make a mutation; the browser
  reflects it. The reverse holds too.
- **Empty bin.** In `Bin`, click `Empty bin`. Items vanish from this
  device and the next push frame; another logged-in tab sees them
  disappear within a second.

If a tab gets into a wedged state (cumulative HMR + OPFS state can
do this in dev), close it and `navigator.storage.getDirectory()` →
`removeEntry` for the account dir to start clean.

## Known follow-ups

- Argon2id login spinner blocks the main thread for ~150ms each
  time. Worker move is tracked in the parent doc.
- Reconnect is fixed-delay only; no online/offline / visibility
  smarts.
- WS auth is `?token=…` on the URL — the slice-4 shortcut. Proper
  ticket-exchange auth waits for iOS/Android.
- Multi-tab sharing of the same engine on one origin would avoid
  duplicate WS sessions per account; not worth the broadcast-channel
  plumbing yet.

## Out of scope (still)

Inherits the parent doc's deferred list, plus slice-4-specific:

- **Argon2id worker.** Login UX is a spinner; deferred.
- **Proper auth ticket exchange.** Token-on-URL is the slice 4
  shortcut.
- **Reconnect policy.** Fixed-delay retry only.
- **Snapshot bootstrap on fresh device.** Op-replay only; acceptable
  while accounts are tiny.
- **Bin/Done restore UX.** Mechanism is trivial
  (`set_item_status(Live)`); the UX (which list does it land in?)
  is a slice 5 design call. Items keep their `list_id` per the data
  model spec, so the data path already works.
- **Touch / mobile.** primavera-dnd is desktop-only currently.
- **Playwright / browser test harness.** Manual smoke this slice.

## Open questions

- **Conditional exports vs. two packages.** We could split into
  `airday-core-web` and `airday-core-node` instead of conditional
  exports on one package. Conditional exports is simpler now;
  splitting is cheap to do later.
- **Solid store granularity.** One `createStore` keyed by id, or
  per-item signals via a `Map<id, signal>`? Default to a single store
  — Solid stores are fine-grained at the property level, and lookup
  by id is trivial.
- **Done/Bin ordering stability.** `done_at` / `binned_at` are client
  clocks. Skewed clocks across devices can briefly produce different
  orders. Acceptable; worth flagging in code comments where the sort
  happens.
