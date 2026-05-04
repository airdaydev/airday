# SaaS

**Status:** sprint 2+. Not implemented in sprint 1; this spec exists to pin the contracts that the sprint-1 server / CLI must not paint themselves out of.

Self-hosted is the default mode. SaaS is a deployment that layers payment, email verification, and tenant policy on top of the same core auth + sync flows. Where SaaS diverges, that divergence is captured here — the rest of the specs assume self-hosted.

## Signup — browser device flow

CLI signup against SaaS does **not** collect email + password in the TTY. SaaS signup involves Stripe, email verification, ToS acceptance, possibly captcha — none of which belong in a terminal. Standard OAuth device-flow pattern:

```
$ airday signup --server saas.airday.com
Open this URL in your browser: https://airday.com/cli-signup?code=ABCD-1234
Waiting for browser confirmation...
✓ Signed in as dan@example.com on device "dans-laptop".
```

Wire contract: `POST /api/account/signup` on a SaaS server returns `{ mode: "browser", url, device_code, poll_interval_secs }` instead of accepting credentials. Self-hosted servers keep the interactive credential-accepting flow from `auth.md`. CLI branches on the response shape — does not need to know which mode the server is in ahead of time.

Polling endpoint: `POST /api/account/signup/poll { device_code }` → `202` while pending, `200 { device_token, account_id, … }` once the browser side completes (account created, device row inserted, encryption material posted from the web client).

The web side handles password collection + KEK derivation + DEK generation + recovery-code display. Everything in `encryption.md` still holds — the browser is just another client doing the same client-side derivation; the server still never sees the password.

`airday login --server saas.airday.com` can stay interactive (password is the actual credential by then), or also offer device-flow for users who'd rather authenticate in the browser. Defer that choice until web ships.

## Cancellation / lapsed accounts

Subscription lapse **never** deletes encrypted data or keys. The server can't decrypt anyway — deletion saves storage cost and re-charges it to the user as permanent data loss for what's typically a transient lapse (failed card, between subscriptions). Local-first means every existing device already has the full doc on disk; the relay going dark doesn't take their data with it.

Lifecycle:

| State | Sync | New device pairing | Local use |
|---|---|---|---|
| Active | full | yes | yes |
| Lapsed, ≤30d | full (grace) | yes | yes |
| Lapsed, 30–90d | read-only (pull ops, no push) | no | yes |
| Lapsed, >90d | blocked | no | yes (offline) |
| Deleted (user-initiated) | n/a | n/a | yes (local copy retained) |

Grace windows are starting points, not load-bearing. The shape — read-write → read-only → blocked, with local devices unaffected throughout — is what matters.

Server retains encrypted blobs + snapshot indefinitely while the account row exists. Reactivation = subscription resumes → state returns to Active, no data restoration step needed. Account deletion is an explicit user action (separate from cancellation) and triggers blob purge after a short cool-off.

## Migration to self-hosted

Users with keys + data on a local device must be able to leave SaaS for a self-hosted server without losing their workspace. Sketch:

```
$ airday export-bundle --out airday.bundle    # any active device
$ airday signup --server https://my-server.example
$ airday import airday.bundle
```

The bundle contains the local Loro doc + the wrapped DEK; the new server gets a fresh signup with the *same* DEK re-wrapped under the new account's KEK, then ingests the doc as the account's initial state. No plaintext crosses the wire.

Specifics (bundle format, atomicity, conflict with an existing self-hosted account on the target server) are deferred until SaaS is live and there's a real user asking.

## Regions and data location

SaaS accounts have a single **home region**. The home region is the place where the account's encrypted workspace data lives and where its steady-state sync traffic terminates.

Initial SaaS regions:

- `Sydney, Australia` (`Binary Lane`)
- `Helsinki, Finland` (`Hetzner`)

User-facing meaning of "home region":

- Encrypted op blobs, snapshots, and steady-state sync for the account live in that region.
- The region does **not** change automatically when the user travels.
- A user who permanently moves country may later run an explicit account migration to a different region.
- Region choice is primarily about data location and legal geography; latency is a secondary benefit.

The signup UI keeps the choice simple ("Choose where your encrypted data lives") and links to a more detailed explanation. That explanation must distinguish:

- home-region workspace storage
- global account / authentication systems
- backup provider and backup region policy

Do not hand-wave backup location. If backups are outside the selected home region, say so explicitly. If backups are region-matched, say that explicitly too.

## Control plane vs data plane

SaaS is split into two planes:

- **Control plane** — globally reachable signup, login, account lookup, billing, subscription state, and region discovery
- **Data plane** — the regional sync/storage service that owns an account's encrypted blobs, snapshots, and device sync traffic

The control plane knows an account's `home_region` and returns region-specific endpoints after signup/login. Steady-state clients talk directly to the regional data plane; the control plane is not on the hot path for every sync operation.

Sketch:

1. Client hits the global SaaS endpoint for signup or login.
2. Control plane authenticates the user/device and resolves `home_region`.
3. Response includes region-specific `api_base_url` and `ws_base_url`.
4. Client stores those endpoints and talks directly to the regional service for steady-state sync.

This keeps account discovery global without turning the sync core into a globally replicated system.

The control plane may be operated from a different region than the account's home region. That is acceptable as long as the split is described honestly in user-facing copy: account/auth metadata may be global, while encrypted workspace data remains pinned to the chosen home region.

## Regional deployment topology

Each account belongs to exactly one region at a time. Within that region, deploy multiple stateless app / WebSocket servers in front of a single regional Postgres cluster.

Per-region shape:

- many stateless HTTP / WS servers
- one regional Postgres cluster as the source of truth
- optional in-region pub/sub for fanout between app instances

The data plane is **region-pinned, not server-pinned**. Any app server in the region may accept a device WebSocket. Correctness must not depend on sticky sessions.

The sync system's durable properties come from Postgres, not the pub/sub layer:

- Postgres assigns / stores the monotonic op ids
- Postgres is the replay source for reconnect / catch-up
- Postgres owns the durable account state

Inter-server fanout is an in-region acceleration layer only. A thin NATS deployment is acceptable for this, but it is not part of the durable sync model. Missed fanout messages must be harmless because clients can always resume from Postgres via `since_op_id`.

NATS JetStream is unnecessary for the base design. Regional sync already has durability, ordering, and replay from Postgres + monotonic op ids; a durable broker would duplicate responsibilities and complicate retention/ordering semantics.

Multi-region replication of the hot path is out of scope for the initial SaaS architecture. The system is single-region per account, with explicit migration between regions if needed later.

## SaaS-only server concerns

Out of scope for this spec but worth flagging so they land somewhere when the time comes:

- Multi-tenant postgres backend (sprint 1 server is single-tenant sqlite).
- Stripe webhook handling, subscription state machine, dunning.
- Email verification: signup gated on `verified_at` populated by a verification round-trip. Self-hosted skips this entirely (see `auth.md` → Account model).
- Per-account storage caps + op-rate limits.
- Abuse / ToS enforcement on accounts whose contents the operator cannot read.
- Per-account size quota — out of scope sprint 1 but worth noting for SaaS.
