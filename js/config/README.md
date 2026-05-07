# Config generation

Renders Airday's runtime config files from templates in `templates/`. Mirrors
the `cooee/js/config` pattern. Two profiles: `dev` (local artifacts under
`local/`) and `deploy` (renders to `deploy/rendered/` on the production box —
see `deploy/README.md`).

## Usage

```bash
# dev — every key has a default, .env is optional
cp js/config/.env.dev.example js/config/.env
bun run config

# deploy — runs on the box during ci.sh, reads /opt/airday/.env
bun run config:deploy
```

Dev outputs:

- `local/server.toml` — server config, picked up by `airday-server`'s default
  `--config` path.
- `local/process-compose.yaml` — `process-compose` recipe for running the
  server + web dev stack together. Run from the repo root:
  `process-compose -f local/process-compose.yaml`.

Deploy outputs:

- `deploy/rendered/server.toml` — installed at `/etc/airday/server.toml`
  by `deploy/ci.sh`.
- `deploy/rendered/Caddyfile` — referenced directly by `caddy.service`
  via the `/opt/airday/current` symlink.

The whole `local/` and `deploy/rendered/` dirs are gitignored.

## Template syntax

A small built-in renderer supports the consul-template subset that cooee uses:

- `{{ env "KEY" }}` — substitute, empty string if missing
- `{{ mustEnv "KEY" }}` — substitute, throw if missing
- `{{ if env "KEY" }}…{{ end }}` — include block only when the var is set

`consul-template` itself is **not** a runtime dependency — the renderer here
just speaks the same syntax so templates stay portable.

## Adding a key

1. Add it to `buildDevEnv` in `gen-config.ts` (with a sensible default).
2. Reference it from the relevant template under `templates/`.
3. Document it in `.env.dev.example` if operators may want to override it.

## Adding a profile

Add a new entry under `profiles` in `gen-config.ts`, write a `buildXEnv`
that validates the required keys via `mustEnv`, and add `.tpl` files that
render to the artifact paths for that profile. The existing `deploy`
profile is the worked example; `cooee/js/config/gen-config.ts` is a
larger reference.
