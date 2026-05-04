# Known Issues

## Reorder undo/redo

Grouped movable-list reorder undo is unsafe in the current core/Loro path.

- Repro: perform a larger reorder as many `move_item(...)` calls inside one undo group, then `undo()`, then `redo()`.
- Observed behavior: redo can corrupt list order and effectively drop/eat trailing items.
- This reproduces in `airday-core` without the web UI, so it is not a projection/render bug.
- The failed `moveItems` experiment was removed. It did not solve the problem and had the same underlying undo-safety issue.

### Current workaround

For launch, reorder does **not** use core undo grouping.

- Reorder still executes as plain per-item `move_item(...)` mutations.
- The web app keeps a thin app-level action-batch stack that records how many plain core undo steps belong to one visible reorder action.
- One user undo/redo for reorder replays `engine.undo()` / `engine.redo()` that many times, then renders once at the end.

### Scope note

This workaround appears acceptable for Airday's task/list UX, but it should not be treated as a durable pattern for higher-stakes domains. Generic grouped undo for important state transitions remains conceptually and technically suspect.
