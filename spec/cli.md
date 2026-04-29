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

Item ids: full uuid v7 hex internally, displayed as 6-char prefix (`a1b2c3`). Subcommands accept any unambiguous prefix; ambiguous prefix → error listing matches.

