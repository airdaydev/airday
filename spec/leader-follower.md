# Leader / Follower Tabs

Launch-safe multi-tab support means **exactly one local browser context owns mutable durable state** for an account at a time.

That owner is the **leader**. Every other tab is a **follower**.

This spec exists to narrow launch risk. It is intentionally conservative.

## Problem

The web client wants:

- multiple tabs on the same origin
- one logical local account state
- one sync connection per account/device
- one persisted OPFS snapshot / frontier per account

Without explicit ownership, multiple tabs can race on:

- OPFS writes
- persisted `lastAckedOpId`
- websocket ownership
- local runtime mutation ordering
- snapshot / save debounce timers

This is a distributed-systems problem, not a UI detail.

## Launch thesis

For launch:

- **Only one tab may own the mutable local runtime.**
- Followers render mirrored state only.
- Followers must never write OPFS.
- Followers must never open the sync websocket.
- Followers must never persist `lastAckedOpId`.

Everything else is an optimization.

## Roles

### Leader

The leader owns all account-local mutation and durability work:

- `Doc`
- `SyncEngine`
- websocket / `SyncBridge`
- OPFS reads and writes
- save debounce
- persisted `lastAckedOpId`
- search index
- undo / redo stacks
- intent execution

### Follower

A follower owns UI and ephemeral page state only:

- mirrored projected state
- local selection / open panels / draft row state
- intent request / response plumbing

A follower does **not** own:

- websocket
- OPFS writes
- engine mutation
- undo / redo truth
- persisted frontier

## Required invariants

1. At most one leader exists per `(origin, accountId)` at a time.
2. Only the leader writes `loro.bin` / `device.json`.
3. Only the leader opens `/api/sync`.
4. Followers must be recoverable from a full snapshot broadcast.
5. Losing follower state is acceptable; losing leader durability is not.
6. Cross-tab correctness must not depend on `unload` / best-effort teardown.

## Coordination primitives

Use browser coordination primitives directly instead of relying on SharedWorker lifecycle semantics alone.

### Web Locks

Use `navigator.locks` for single-owner election.

Lock name:

```text
airday-runtime:<accountId>
```

Purpose:

- exactly one leader acquires the lock
- lock release on tab death is browser-managed
- followers retry lock acquisition when leader heartbeats stop

### BroadcastChannel

Use one `BroadcastChannel` per account:

```text
airday:<accountId>
```

Purpose:

- leader discovery
- heartbeats / liveness
- follower intent forwarding
- leader event / snapshot fanout
- follower resync requests

`BroadcastChannel` is part of the correctness path. SharedWorker is optional optimization on top.

## Runtime placement

This spec is compatible with two implementations:

1. **Page leader runtime**
   - the leader tab owns the runtime directly
   - simplest launch-safe model
2. **SharedWorker-backed leader runtime**
   - the leader tab bootstraps a worker-owned runtime
   - followers still coordinate through the same leader/follower protocol

For launch, prefer whichever implementation is simpler to reason about. Correctness comes from the leader/follower model, not from SharedWorker itself.

## Protocol

All coordination messages are local-only `BroadcastChannel` messages.

Each message carries:

- `accountId`
- `leaderId` or `clientId` as appropriate
- `epoch`

`epoch` is a monotonically increasing leader generation chosen by the new leader when it takes ownership. Followers discard stale messages from older epochs.

### Message types

#### `leader-hello`

Sent immediately when leadership is acquired.

```ts
{
  type: "leader-hello";
  accountId: string;
  leaderId: string;
  epoch: number;
}
```

#### `leader-heartbeat`

Sent periodically while leader is live.

```ts
{
  type: "leader-heartbeat";
  accountId: string;
  leaderId: string;
  epoch: number;
  ts: number;
}
```

#### `snapshot`

Full projected-state refresh for followers.

```ts
{
  type: "snapshot";
  accountId: string;
  leaderId: string;
  epoch: number;
  snapshot: ProjectionSnapshot;
}
```

#### `events`

Incremental projected-state updates from the leader.

```ts
{
  type: "events";
  accountId: string;
  leaderId: string;
  epoch: number;
  events: AppEventJs[];
  status: RuntimeStatus;
}
```

#### `intent`

Follower requests a mutation from the leader.

```ts
{
  type: "intent";
  accountId: string;
  clientId: string;
  requestId: string;
  intent: Intent;
}
```

#### `intent-result`

Leader replies to one follower request.

```ts
{
  type: "intent-result";
  accountId: string;
  clientId: string;
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}
```

#### `resync-request`

Follower asks for a fresh full snapshot when it detects drift or joins late.

```ts
{
  type: "resync-request";
  accountId: string;
  clientId: string;
}
```

## Startup flow

1. Page loads session from the session vault.
2. Page opens `BroadcastChannel("airday:<accountId>")`.
3. Page tries to acquire `navigator.locks.request("airday-runtime:<accountId>", ...)`.
4. If lock is acquired:
   - page becomes leader
   - boot runtime from OPFS
   - start websocket if authenticated
   - broadcast `leader-hello`
   - broadcast full `snapshot`
5. If lock is not acquired:
   - page becomes follower
   - wait for `leader-hello` / `leader-heartbeat`
   - request resync if no fresh `snapshot` arrives promptly

Followers should not boot a local mutable runtime for the same account.

## Intent flow

### Leader tab action

1. UI issues intent locally.
2. Leader runtime applies intent.
3. Leader drains app events.
4. Leader updates local projection/search/undo state.
5. Leader schedules OPFS save.
6. Leader pumps sync outbox if authenticated.
7. Leader broadcasts `events`.
8. Leader resolves local UI promise.

### Follower tab action

1. UI issues intent.
2. Follower posts `intent` over `BroadcastChannel`.
3. Leader applies it through the same path as above.
4. Leader sends `intent-result`.
5. Leader broadcasts the resulting `events`.
6. Follower resolves UI promise only when `intent-result` arrives.

Follower UI may show optimistic ephemeral affordances, but must not mutate canonical mirrored state on its own.

## Liveness

Best-effort page teardown is not sufficient.

Leader liveness is based on heartbeats, not on `detach`.

Suggested defaults:

- heartbeat interval: `1000 ms`
- leader considered dead after: `3000 ms` to `5000 ms` without heartbeat

When a follower declares the leader dead:

1. clear leader-local mirrored connection status to "reconnecting"
2. retry lock acquisition
3. if lock acquired, become new leader
4. boot runtime from OPFS
5. reconnect websocket
6. broadcast fresh `snapshot`

## Failure handling

### Leader closes or crashes

- browser releases the lock
- heartbeats stop
- follower elects itself via lock acquisition
- new leader loads OPFS and resumes sync

### Follower closes or crashes

- no correctness issue
- optional follower presence bookkeeping may age out eventually

### BroadcastChannel message loss or late join

- follower requests `resync-request`
- leader answers with full `snapshot`

### Leader restart with stale in-flight UI promises

- followers reject or timeout old requests
- next `snapshot` re-establishes canonical state

## SharedWorker stance

SharedWorker may still be used, but it is not the correctness mechanism.

If used:

- only the leader should bootstrap the mutable runtime
- followers should still consume leader broadcasts as mirrors
- do not rely on worker port teardown for exclusive ownership

SharedWorker is allowed to fail without violating local-state correctness, as long as the leader/follower election and snapshot fanout still hold.

## Follower capabilities at launch

Two acceptable launch policies:

### Option A: full follower intents

Followers can perform all actions through leader-forwarded intents.

Pros:

- better UX

Cons:

- requires request/response plumbing and retry semantics

### Option B: read-only followers

Followers render state and show a banner:

```text
Airday is active in another tab. This tab is read-only until that tab closes.
```

Pros:

- smallest launch risk

Cons:

- weaker UX

If schedule pressure is high, choose Option B first.

## Non-goals

This spec does not attempt to solve:

- multi-leader local merge
- per-tab local runtime mutation with later reconciliation
- offline follower mutation queues
- peer-to-peer tab sync without leader election
- cross-browser-account shared local state

Those are post-launch expansions.

## Testing

Add a dedicated local coordination test layer.

Required cases:

1. two tabs, one becomes leader, one follower
2. only leader opens websocket
3. only leader writes OPFS
4. follower receives live event updates from leader
5. follower intent routes through leader and updates both tabs
6. leader closes, follower takes lock and becomes new leader
7. follower joins late and receives full snapshot
8. rapid reload does not produce durable-state races

Tests should assert:

- exactly one runtime owns sync at a time
- exactly one runtime writes persistence at a time
- follower state converges to leader snapshot/events

## Migration note

If the existing architecture already has:

- page-owned session vault
- worker/page intent protocol
- projected state snapshots and event streams

then this spec should be implemented by moving ownership control **above** the runtime, not by teaching every tab to own a full runtime and somehow stay polite.

The ownership boundary is the load-bearing piece.
