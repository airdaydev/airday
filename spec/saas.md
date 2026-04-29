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

## SaaS-only server concerns

Out of scope for this spec but worth flagging so they land somewhere when the time comes:

- Multi-tenant postgres backend (sprint 1 server is single-tenant sqlite).
- Stripe webhook handling, subscription state machine, dunning.
- Email verification: signup gated on `verified_at` populated by a verification round-trip. Self-hosted skips this entirely (see `auth.md` → Account model).
- Per-account storage caps + op-rate limits.
- Abuse / ToS enforcement on accounts whose contents the operator cannot read.
- Per-account size quota — out of scope sprint 1 but worth noting for SaaS.
