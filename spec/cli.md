# CLI

Primary CLI client. Also the integration test surface for everything below the GUI.

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
- `airday lists ls`
- `airday lists add <name>`
- `airday lists rename <list> <name>`
- `airday lists rm <list>`

### Bin
- `airday bin show`
- `airday bin empty`
- `airday bin rm <item_id>`

### Status
- `airday status` — server URL, account email, device id, last successful sync timestamp, `last_acked_op_id`, pending-push op count. Read-only against local state; never opens a WS.

### Cache
- `airday cache status` — profile directory and `loro.bin` size. Read-only; never opens a WS.
- `airday cache clear [--force]` — delete `loro.bin` and reset `last_acked_op_id` to 0; the next `airday sync` rehydrates from the server. If there are unsynced local ops, prompts for confirmation (TTY) or refuses with an error (non-TTY) unless `--force` is passed.

### Sync
- `airday sync` — pull peer ops, push any pending local ops, then exit. Connect failure is a hard error.

## Sync lifecycle

CLI subcommands are one-shot and **offline by default**. Reads (`ls`, `status`, `lists ls`) and writes (`add`, `done`, `mv`, ...) operate against the local Loro doc only; mutations append to `loro.bin` and ship on the next sync.

To hit the network, pass `-s` / `--sync` on any command (or set `AIRDAY_SYNC=1`): open WS → version handshake → `PullOps { since_op_id: last_acked_op_id }` → apply → run the command → `PushOps` if anything changed → `Ack` → close. The dedicated `airday sync` command is the same path with no doc mutation.

A future TUI may hold the WS open while running and surface `OpsBroadcast` reactively in the same `airday` binary. The daemon question stays deferred until the TUI exists and proves it needs more than that.

### Connect behaviour

- Default: no network attempt. Local doc is authoritative. Mutations queue in `loro.bin`.
- `-s` / `--sync` / `AIRDAY_SYNC=1`: attempt WS connect with a ~2s timeout. On failure (no network, captive portal, server down), fall back to local-only and print a one-line stderr warning: `offline — sync deferred (<reason>)`. The command still runs against the local doc.
- `airday sync`: same connect attempt, but failure exits non-zero — there's no local work to fall back to.
- `airday login` and `airday recover` always attempt an initial sync after writing the profile; failure is a soft warning (they've already provisioned the account, the user can `airday sync` later).
- Pending local ops live in `loro.bin`; the next sync pushes them as part of `PushOps`.

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
