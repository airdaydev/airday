# Airday deploy

Single-VPS, Debian 13 + systemd + Caddy. One Rust binary
(`airday-server`, sqlite-backed) plus the static web bundle, served from
the same hostname so SameSite=Strict cookies work end-to-end (see
`memory: bundle origin = API origin`).

Modeled on `cooee/infra/deploy` — same `/opt/<app>/{source,releases,
current,cargo-target}` layout, same template-rendered config flow, just
trimmed: no postgres, no SaaS, no SSR, no wildcard DNS challenge.

## Layout on the box

```
/opt/airday/
  source/        # git checkout, deploy fetches into this
  releases/      # timestamped release dirs (last 5 retained)
  current        # symlink → active release
  cargo-target/  # shared CARGO_TARGET_DIR across releases
  .env           # deploy secrets (mode 0600, owned by airday)
/etc/airday/
  server.toml    # rendered from js/config/templates/server.deploy.toml.tpl
/var/lib/airday/
  airday.sqlite  # the only writable path the systemd unit allows
```

## First-time setup

```bash
# As root on a fresh Debian box:
ssh root@<ip> 'bash -s' < deploy/bootstrap.sh

# Add deploy secrets:
scp js/config/.env.deploy.example root@<ip>:/opt/airday/.env
ssh root@<ip> 'chown airday:airday /opt/airday/.env && chmod 600 /opt/airday/.env'
ssh airday@<ip> 'editor /opt/airday/.env'   # fill in AIRDAY_HOST + CADDY_EMAIL

# DNS: point AIRDAY_HOST at the box (Caddy uses HTTP-01 — no CF token needed).

# First deploy:
ssh airday@<ip> 'bash /opt/airday/source/deploy/ci.sh'
```

## Subsequent deploys

`deploy/ci.sh` is the deploy. It can run from a CI runner over ssh as
`airday`, or by hand:

```bash
ssh airday@<ip> 'bash /opt/airday/source/deploy/ci.sh'
```

Pin a different ref with `DEPLOY_REF=origin/some-branch` or a sha.

What it does:

1. `git fetch && git reset --hard $DEPLOY_REF` in `source/`
2. `rsync` source → a fresh `releases/<timestamp>-<sha>/`
3. Stage `/opt/airday/.env` as `js/config/.env`, run `bun run config:deploy`
   to render `deploy/rendered/{Caddyfile,server.toml}`
4. `bun run build:wasm:web` → `js/core/wasm-web/`
5. `(cd js/web && bun run build)` → `js/web/dist/`
6. `cargo build --release -p airday-server`, copy the binary into the
   release dir
7. `install` the rendered `server.toml` to `/etc/airday/server.toml`
8. Flip the `current` symlink, `systemctl restart airday caddy`
9. Prune to last 5 release dirs

## Caddy

The unit reads its config from
`/opt/airday/current/deploy/rendered/Caddyfile` directly — no copy step.
`reload` works out of the box (`sudo systemctl reload caddy`), but `ci.sh`
just restarts both because the airday binary changes too.

Caddy serves `js/web/dist` statically and reverse-proxies `/healthz` and
`/api/*` to `127.0.0.1:8000`. WebSocket upgrades on `/api/sync` work
without extra config — `reverse_proxy` handles it.

## Secrets / config

| File | Purpose |
|---|---|
| `/opt/airday/.env` | deploy secrets, source of truth (mode 0600) |
| `js/config/.env.deploy.example` | template for the above |
| `js/config/templates/Caddyfile.deploy.tpl` | renders to `deploy/rendered/Caddyfile` |
| `js/config/templates/server.deploy.toml.tpl` | renders to `deploy/rendered/server.toml`, installed at `/etc/airday/server.toml` |

Required keys: `AIRDAY_HOST`, `CADDY_EMAIL`. Everything else has a
sensible default (see `buildDeployEnv` in `js/config/gen-config.ts`).

## Permissions model

- `/opt/airday` owned by `airday:airday`; deploys run as `airday`.
- `airday` has NOPASSWD sudo for **only**:
  - `systemctl daemon-reload`
  - `systemctl restart airday.service`
  - `systemctl restart caddy.service`
- `/etc/airday/server.toml` is mode 0640, `root:airday` — `ci.sh` sudo's
  the install. (The systemd unit reads it; airday-server doesn't write it.)

## Backups

Sqlite. `/var/lib/airday/airday.sqlite` is the whole world. Snapshot the
file (use `sqlite3 ... .backup`, or stop the unit briefly) and ship it
somewhere off-box. Not wired up yet — single-human-user product, so
"copy the file when you remember" is the floor.

## Future

- Optional Cloudflare DNS-01 if we ever want a wildcard or no public 80/443.
- TLS-cert renewal monitoring (Caddy logs are fine for now).
- Per-host config split if we end up running alpha + prod from one repo.
