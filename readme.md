# Airday

[Airday](https://air.day/) is an e2ee, realtime, tasks app i.e. todo list with conflict resolution backed by Loro.

⚠️ ATTN: Airday is undergoing extensive and frequent changes, it is not ready to use.

## Saas vs Self-hosted
This is the private repo currently containing everything. We will extract most of this repo into a public repo prior to release.

```
📁 monorepo
├── 📂 cli  → CLI app
├── 📂 ios          → iOS app placeholder
├── 📂 js           → JavaScript packages and web app
├── 📂 core         → Rust shared core
├── 📂 crates         → Rust packages
├── 📂 server       → Server
├── 📂 sqlite       → Sqlite migration & notes
└── 📂 telemetry    → Jaeger & OTLP collector for dev envs (may upgrade to clickstack)
```

## Development Requirements
- Rust
- Bun
- sqlx-cli: (`cargo install sqlx-cli`)
- caddy with cloudflare plugin:
```
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
export PATH="$PATH:$(go env GOPATH)/bin" >> .zshenv
xcaddy build --with github.com/caddy-dns/cloudflare
mv caddy /usr/local/bin
```

## Development Setup (MacOS & Arch Linux)
```bash
bun install
bun run config
process-compose up
```

- This repo will remain private
- Airday core will be BSL-licensed with some MIT-licensed components
