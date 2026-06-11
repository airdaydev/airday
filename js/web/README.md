# @airday/web

Solid + Vite + TS web client.

## Prerequisites

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
