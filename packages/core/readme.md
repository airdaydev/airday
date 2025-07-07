## @airday/core

Airday JavaScript Client handling
- Auth & account management APIs
- Core data types
- Sync w/cross-tab management over WS with WAL persistence
- Persistent cache backed by indexedb
- Undo/redo
- TODO: E2EE management
- TODO: JMAP calendar management
- TODO: Profile uuid string vs bytes representation

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
