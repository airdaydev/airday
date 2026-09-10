# Monoplan deploy

Single-VPS, Debian 13 + systemd + Caddy. One Rust binary
(`monoplan-server`, sqlite-backed) plus the static web bundle, served from
the same hostname so SameSite=Strict cookies work end-to-end (see
`memory: bundle origin = API origin`).

## Layout on the box

```
/opt/monoplan/
  source/        # git checkout, deploy fetches into this
  releases/      # timestamped release dirs (last 5 retained)
  current        # symlink → active release
  cargo-target/  # shared CARGO_TARGET_DIR across releases
  .env           # deploy secrets (mode 0600, owned by monoplan)
/etc/monoplan/
  server.toml    # rendered from js/config/templates/server.deploy.toml.tpl
/var/lib/monoplan/
  monoplan.sqlite  # the only writable path the systemd unit allows
```

## First-time setup

```bash
# As root on a fresh Debian box:
ssh root@<ip> 'bash -s' < deploy/bootstrap.sh

# Add deploy secrets:
scp js/config/.env.deploy.example root@<ip>:/opt/monoplan/.env
ssh root@<ip> 'chown monoplan:monoplan /opt/monoplan/.env && chmod 600 /opt/monoplan/.env'
ssh monoplan@<ip> 'editor /opt/monoplan/.env'   # fill in MONOPLAN_HOST + CADDY_EMAIL

# DNS: point MONOPLAN_HOST at the box (Caddy uses HTTP-01 — no CF token needed).

# First deploy:
ssh monoplan@<ip> 'bash /opt/monoplan/source/deploy/ci.sh'
```

## Subsequent deploys

`deploy/ci.sh` is the deploy. It can run from a CI runner over ssh as
`monoplan`, or by hand:

```bash
ssh monoplan@<ip> 'bash /opt/monoplan/source/deploy/ci.sh'
```

Pin a different ref with `DEPLOY_REF=origin/some-branch` or a sha.

What it does:

1. `git fetch && git reset --hard $DEPLOY_REF` in `source/`
2. `rsync` source → a fresh `releases/<timestamp>-<sha>/`
3. Stage `/opt/monoplan/.env` as `js/config/.env`, run `bun run config:deploy`
   to render `deploy/rendered/{Caddyfile,server.toml}`
4. `bun run build:wasm:web` → `js/core/wasm-web/`
5. `(cd js/web && bun run build)` → `js/web/dist/`
6. `cargo build --release -p monoplan-server`, copy the binary into the
   release dir
7. `install` the rendered `server.toml` to `/etc/monoplan/server.toml`
8. Flip the `current` symlink, `systemctl restart monoplan caddy`
9. Prune to last 5 release dirs

## Caddy

The unit reads its config from
`/opt/monoplan/current/deploy/rendered/Caddyfile` directly — no copy step.
`reload` works out of the box (`sudo systemctl reload caddy`), but `ci.sh`
just restarts both because the monoplan binary changes too.

Caddy serves `js/web/dist` statically and reverse-proxies `/healthz` and
`/api/*` to `127.0.0.1:8000`. WebSocket upgrades on `/api/sync` work
without extra config — `reverse_proxy` handles it.

## Secrets / config

| File | Purpose |
|---|---|
| `/opt/monoplan/.env` | deploy secrets, source of truth (mode 0600) |
| `js/config/.env.deploy.example` | template for the above |
| `js/config/templates/Caddyfile.deploy.tpl` | renders to `deploy/rendered/Caddyfile` |
| `js/config/templates/server.deploy.toml.tpl` | renders to `deploy/rendered/server.toml`, installed at `/etc/monoplan/server.toml` |

Required keys: `MONOPLAN_HOST`, `CADDY_EMAIL`. Everything else has a
sensible default (see `buildDeployEnv` in `js/config/gen-config.ts`).

## Permissions model

- `/opt/monoplan` owned by `monoplan:monoplan`; deploys run as `monoplan`.
- `monoplan` has NOPASSWD sudo for **only**:
  - `systemctl daemon-reload`
  - `systemctl restart monoplan.service`
  - `systemctl restart caddy.service`
- `/etc/monoplan/server.toml` is mode 0640, `root:monoplan` — `ci.sh` sudo's
  the install. (The systemd unit reads it; monoplan-server doesn't write it.)

## Backups

Sqlite. `/var/lib/monoplan/monoplan.sqlite` is the whole world. Snapshot the
file (use `sqlite3 ... .backup`, or stop the unit briefly) and ship it
somewhere off-box. Not wired up yet — single-human-user product, so
"copy the file when you remember" is the floor.

## Future

- Optional Cloudflare DNS-01 if we ever want a wildcard or no public 80/443.
- TLS-cert renewal monitoring (Caddy logs are fine for now).
- Per-host config split if we end up running alpha + prod from one repo.
