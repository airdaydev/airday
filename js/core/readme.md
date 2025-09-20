## @airday/core

Airday JS client lib for browser handling:
- Auth & account management APIs
- Core data types
- Sync over WS persistence
- Persistent cache backed by indexedb
- TODO: Undo/redo
- TODO: cross-tab management
- TODO: E2EE management
- TODO: Calendar management
- TODO: Profile uuid string vs bytes representation

## Tests
Using real browser - bun test was nice, but lack of idb means reliance on polyfill which in practice was too slow and we have to do perf tests anyway, so here we are
```bash
pnpm exec playwright install # install all browsers
pnpx playwright install firefox # install ff only
```

## Outbox plan
I am bringing back a message outbox to ensure that local changes do make it into a history. V1 will be a literal change by change history, V2 will group (or remove in case of a tombstone) changes where possible (optimisation). Outbox will be patched with OG item in a transaction. This will retain even local history (maybe undesired, tbh). For now we do not need to store changesets on items, merely the inbox itself.

V2 could have different compacting configs.

## Undo/redo notes
something like this

Action[]

where Action {
resourceType,
resourceId,
resourceAttribute,
}

i might hash/index for lookup and comparison perf

anyway if an update comes in that matches that same type/id/attribute combo, i will simply remove it from the undo/redo stack

i will also have to create a redo stack much the same but inverses the action

i will consider put a slight debounce on committing these updates as u can fire through them quite rapidly
