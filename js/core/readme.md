## @airday/core

Airday JS Browser Client handling:
- Auth & account management APIs
- Core data types
- Sync over WS persistence
- Persistent cache backed by indexedb
- TODO: Undo/redo
- TODO: cross-tab management
- TODO: E2EE management
- TODO: Calendar management
- TODO: Profile uuid string vs bytes representation
- TODO: literally just a bit instead of top level message definition..? e.g. 0 = Airday, 1 = JMAP (TODO: REMOVE)

## Tests
Using real browser - bun test was nice, but lack of idb means reliance on polyfill which in practice was too slow and we have to do perf tests anyway, so here we are
```bash
pnpx playwright install firefox
```

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
