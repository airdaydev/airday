## @airday/core

Airday JS client lib for browser handling:
- Auth & account management APIs
- Core data types
- Sync over WS persistence
- Persistent cache backed by indexedb
- TODO: Undo/redo
- TODO: cross-tab management
- TODO: E2EE management
- TODO: Caldav adapter

## Tests
Using real browser - bun test was nice, but lack of idb means reliance on polyfill which in practice was too slow and we have to do perf tests anyway, so here we are
```bash
bunx playwright install # install all browsers
bunx playwright install firefox # install ff only
```

## Outbox plan
I am bringing back a message outbox to ensure that local changes do make it into a history. V1 will be a literal change by change history, V2 will group (or remove in case of a tombstone) changes where possible (optimisation). Outbox will be patched with OG item in a transaction. This will retain even local history (maybe undesired, tbh). For now we do not need to store changesets on items, merely the inbox itself.

V2 could have different compacting configs.

## Undo/redo
Create a change stack that implements intention to inverse an action to current user's previous change.
Remove id/attr combos that have been since affected by other users
Inverse now tombstoned items get dropped too - hard delete
