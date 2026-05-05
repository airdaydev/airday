Plan

  Implement this as a page-owned Vault plus worker-owned runtime. The page loads session
  material, bootstraps the worker once, and then gets out of the way. The worker owns doc
  state, sync, persistence, and fanout.

  1. Formalize the page-owned vault
  Use js/web/src/dekVault.ts as the real boundary and rename/reframe it as a session
  vault, not a DEK helper.

  Responsibilities:

  - load current session
  - save current session
  - clear on logout
  - return a bootstrap payload for the worker

  Bootstrap payload should contain only what the worker needs to start:

  - anonymous
  - accountId
  - email
  - deviceId
  - live dek
  - maybe freshSignup

  Do not move vault persistence into the worker.

  2. Define a host protocol
  Create a small typed protocol, probably in js/web/src/host/protocol.ts.

  Message groups:

  - page -> worker: bootstrap, intent, query, shutdown
  - worker -> page: bootstrapped, events, status, queryResult, authFailed, fatal

  Important decision:

  - one active account per worker
  - connection is account-bound at bootstrap
  - no per-message accountId

  3. Add a page-side worker client
  Create something like js/web/src/host/client.ts.

  Responsibilities:

  - construct SharedWorker
  - send bootstrap exactly once per page session
  - expose sendIntent(...)
  - expose subscriptions for events/status
  - handle reconnect/re-attach to an already-live worker

  This becomes the only page-level API for account state.

  4. Extract a worker runtime from current page code
  Today MainApp in js/web/src/App.tsx:361 owns:

  - engine creation
  - OPFS storage
  - websocket bridge
  - save debounce

  Move that into a worker runtime module, e.g. js/web/src/host/runtime.ts.

  Worker runtime owns:

  - Doc
  - SyncEngine
  - storage adapter
  - SyncBridge
  - save scheduling
  - connected ports list
  - broadcast of state changes and status

  5. Split projection logic into host-side and page-side
  js/web/src/store.ts:169 currently mixes:

  - engine mutation methods
  - app-event projection
  - Solid store integration
  - search
  - undo bookkeeping

  Split it into:

  - host-side projector/runtime state
  - page-side mirrored UI store

  Host side should own:

  - canonical projected state
  - undo/redo stacks
  - search index

  Page side should own:

  - Solid reactivity over mirrored projected state
  - ephemeral UI state only

  6. Use AppEventJs[] as the replication format
  Do not invent changed-id patch formats first.

  Protocol shape:

  - initial bootstrapped message contains full projected state snapshot
  - subsequent updates are ordered AppEventJs[]
  - optional full resync snapshot if a page falls behind

  This stays close to the existing event model and reduces refactor risk.

  7. Move search fully into the worker
  spec/search.md already wants search beside the app-event stream.

  Worker owns:

  - search build on boot
  - incremental search updates on every event drain
  - search query execution

  Page sends query text and gets results back. Do not duplicate the index per tab.

  8. Convert all mutations to intents
  The page should stop calling engine/app mutation methods directly.

  Intents should cover the current surface from js/web/src/store.ts:169:

  - addItem
  - addItemAt
  - addItemsAt
  - editItemText
  - editItemNotes
  - setDone
  - setDoneMany
  - setBinned
  - setBinnedMany
  - moveItem
  - deleteBinned
  - deleteBinnedMany
  - emptyBin
  - addList
  - renameList
  - moveList
  - deleteList
  - undo
  - redo

  Worker applies intent, drains events, persists, pumps sync outbox, broadcasts resulting
  events.

  9. Make anonymous mode explicit
  Worker runtime should support two normal modes:

  - anonymous_local
  - authenticated_syncing

  Anonymous mode:

  - loads/saves OPFS
  - applies local intents
  - maintains undo/redo
  - broadcasts updates to tabs
  - never starts SyncBridge

  This is not a fallback path or error mode.

  10. Put OPFS writes exclusively in the worker
  Only the worker should use js/core/src/storage/opfs.ts.

  Move the save debounce from js/web/src/App.tsx:408 into the worker runtime:

  - save after version bumps
  - persist lastAckedOpId
  - flush on last-port disconnect if practical

  This removes multi-tab persistence contention.

  11. Put websocket ownership exclusively in the worker
  Only the worker should instantiate js/web/src/sync.ts:1.

  Worker behavior:

  - authenticated sessions start SyncBridge
  - remote ops drain through the same event path
  - online/offline/auth-failed status is broadcast to all tabs

  This gets you one browser-local sync engine and one socket.

  12. Simplify App.tsx
  App.tsx should become:

  - load vault session
  - create/get worker client
  - send bootstrap payload
  - mount Workspace against mirrored state
  - keep login/logout/session swap orchestration

  It should stop owning:

  - SyncEngine
  - OpfsStorage
  - SyncBridge
  - persistence debounce

  13. Handle login/logout/session swap cleanly
  On login/signup:

  - page writes vault
  - page sends new bootstrap to worker or requests worker reset
  - worker tears down old runtime and starts new one

  On logout:

  - page clears vault
  - page tells worker to discard runtime
  - page creates fresh anonymous session and bootstraps that

  Since web is single-account, runtime replacement is fine.

  14. Add a fallback seam, not fallback implementation
  Create a transport abstraction now:

  - connect
  - disconnect
  - send
  - subscribe

  Implement only SharedWorkerTransport for now. Leave room for a future leader-tab
  fallback without polluting the first pass.

  15. Test in this order

  1. Protocol tests

  - bootstrap
  - intent/result
  - event delivery
  - status delivery

  2. Worker runtime tests

  - anonymous boot
  - authenticated boot
  - local intent updates projection once
  - remote sync updates projection once
  - save debounce writes expected state

  3. Multi-tab integration tests

  - two tabs attach to one worker
  - tab A mutation appears in tab B
  - only one sync bridge/socket exists
  - reload one tab without losing runtime

  4. Failure tests

  - auth failure logs out all tabs
  - OPFS unavailable degrades cleanly
  - worker startup error surfaces clearly

  Suggested implementation order

  1. Rename/formalize the vault boundary.
  2. Add host protocol types.
  3. Add page-side SharedWorker client.
  4. Extract worker runtime from MainApp.
  5. Move SyncBridge and OPFS save logic into worker.
  6. Change page mutations into intents.
  7. Move search into worker.
  8. Remove page-owned engine/storage/sync.
  9. Add tests for two-tab behavior.

  Main risk
  The hardest refactor is js/web/src/store.ts:169, because it currently combines
  canonical state logic and UI-facing state logic. That split is the load-bearing change.

  If you want, I can turn this into a file-by-file checklist with exact new modules and
  likely edits in App.tsx, store.ts, and sync.ts.
