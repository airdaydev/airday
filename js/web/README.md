# @airday/web

Solid + Vite + TS web client.

## Prerequisites

The DnD primitive is consumed from sibling repo
`../../../primavera-ui` via Bun `link:` while pre-1.0. **Build it
once before installing this package**:

```sh
cd ../../../primavera-ui/packages/components && bun run build
```

Re-run after pulling primavera-ui changes; `link:` resolves to the
sibling's `dist/`.

The wasm bundle for browsers is built via:

```sh
bun run build:wasm:web
```

from the repo root. `js/core` exports the bundler-target build to
this package automatically through conditional exports.

## Running

```sh
bun install               # from repo root
bun run build:wasm:web    # produces js/core/wasm-web/
bun --cwd js/web dev      # http://localhost:5176
```
