# CLI

Sprint 1's primary client. Also the integration test surface for everything below the GUI.

## Binary

Single binary `airday`. Subcommands:

### Account
- `airday signup [--server URL]` — interactive: email, password, optional recovery code generation
- `airday login [--server URL]` — interactive: email, password
- `airday logout`
- `airday recover` — interactive: email, recovery code, set new password
- `airday password` — change password (logged in)

### Devices
- `airday devices` — list
- `airday devices revoke <device_id>`

### Items
- `airday add <text> [--list <list>]` — `<text>` of `-` reads from stdin; one item per non-blank line
- `airday ls [--list <list>]`
- `airday done <item_id>`
- `airday bin <item_id>`
- `airday restore <item_id>`
- `airday mv <item_id> <list>`
- `airday edit <item_id> <text>`

### Lists
- `airday lists`
- `airday lists add <name>`
- `airday lists rename <list> <name>`
- `airday lists rm <list>`

### Bin
- `airday bin show`
- `airday bin empty`
- `airday bin rm <item_id>`

### Status
- `airday status` — server URL, account email, device id, last successful sync timestamp, `last_acked_op_id`, pending-push op count, current offline mode. Read-only against local state; never opens a WS.

## Sync lifecycle

CLI subcommands are one-shot. Each invocation: open WS → version handshake → `PullOps { since_op_id: last_acked_op_id }` → apply → run the command (mutating or not) → `PushOps` if anything changed → `Ack` → close. No background daemon in sprint 1.

A future TUI (out of sprint 1) holds the WS open while running and surfaces `OpsBroadcast` reactively in the same `airday` binary. The daemon question stays deferred until the TUI exists and proves it needs more than that.

Local Loro doc is always authoritative for reads. `airday ls` and friends never block on or fail because of sync state — they read local and exit. Sync exists to ingest other devices' ops and ship local ones, not to gate reads.

### Connect behaviour

- Default: attempt WS connect with a ~2s timeout. On failure (no network, captive portal, server down), fall back to local-only and print a one-line stderr warning: `offline — N ops pending push`.
- `--offline` flag or `AIRDAY_OFFLINE=1`: skip the network attempt entirely, no warning. Mutations append to the local doc; the queue flushes on the next online invocation.
- Pending local ops live in `loro.bin` alongside the rest of the doc state; the next online invocation pushes them as part of its normal `PushOps`.

## Local state

Single account per install. Per-account dir under XDG paths (`~/.local/share/airday/<account-id-prefix>/` on linux, equivalents elsewhere) — the prefix scopes state so a logout/re-signup as a different user doesn't collide with stale data, but only one account is active at a time:

- `loro.bin` — local Loro doc snapshot, persisted on every commit
- `device.json` — `{ device_id, server_url, last_acked_op_id, account_id, email }`

Secrets in OS keychain (`security` on macOS, `libsecret` on linux):
- `airday:<account_id>:token` — device auth token
- `airday:<account_id>:dek` — DEK (only when "stay logged in" is chosen; otherwise re-derived from password each session)

Recovery code is **never** persisted by the client — shown once at signup, user records it themselves.

## Bootstrap UX

### First device
```
$ airday signup
Server: https://airday.example
Email: dan@example.com
Password: ********
Generate recovery code? [Y/n]
  → 12 words shown once, user must type them back to confirm
Device name [hostname]:
Done. Doc initialized.
```

### Second device
```
$ airday login
Server: https://airday.example
Email: dan@example.com
Password: ********
Device name [hostname]:
Syncing... (snapshot, then ops)
Done.
```

### Recovery
```
$ airday recover
Server: https://airday.example
Email: dan@example.com
Recovery code (12 words): ...
New password: ********
Device name [hostname]:
Syncing...
Done.
```

## Output

Default output: human-readable. `--json` flag on every read command emits machine-parseable JSON for tests and scripting.

Item and list ids: full uuid v7 hex (32 chars), shown verbatim and required in full when an id is passed in. Built-in list `now` is the one literal id. (Earlier drafts of this spec proposed prefix matching; dropped because it adds parsing complexity for marginal ergonomic gain over shell completion / copy-paste.)

