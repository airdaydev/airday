# Config generation

Renders Airday's runtime config files from templates in `templates/`. Mirrors
the `cooee/js/config` pattern, simplified to a single `dev` profile for now.

## Usage

```bash
cp js/config/.env.dev.example js/config/.env  # optional — every key has a default
bun js/config/gen-config.ts                    # or: cd js/config && bun run config
```

Outputs:

- `local/server.toml` — server config, picked up by `airday-server`'s default
  `--config` path. The whole `local/` dir is gitignored and used for any other
  generated dev artifacts as they show up.

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

## Adding a profile (e.g. `deploy`)

Add a new entry under `profiles` in `gen-config.ts`, write a `buildDeployEnv`
that validates the required keys via `mustEnv`, and add `.tpl` files that
render to the deploy artifact paths. See `cooee/js/config/gen-config.ts` for
the full shape.
