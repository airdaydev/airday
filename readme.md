# Airday Core

[Airday](https://air.day/) calendar & tasks app monorepo. Powers both SaaS & self-hosted versions.*

*Airday SaaS hosted at air.day front-end uses this repo exactly, but uses a modified server to deal with delivery.

⚠️ ATTN: Airday is undergoing extensive and frequent changes, it is not ready to use.

```
📁 monorepo
├── 📂 flatbuffers  → Protocol definitions and code gen
├── 📂 ios          → iOS app placeholder
├── 📂 js           → JavaScript packages
├── 📂 rust         → Rust packages
├── 📂 server       → Rust based server
├── 📂 sqlite       → Sqlite migration & notes
├── 📂 telemetry    → Jaeger & OTLP collector for dev envs
└── 📂 web          → Web based application
```

## Self-hosting
Coming 2026

## Development Requirements
- Rust
- Bun
- pnpm
- sqlx-cli: (`cargo install sqlx-cli`)
- flatbuffers (flatc cli)

## Development Setup (MacOS & Arch Linux)
```bash
sudo systemctl start docker # if not started
pnpm run jaeger # to get tracing (system tests rely on this currently)
./prep.sh # sets up database, config, downloads js deps, etc
pnpm run test # runs ALL tests aka ./test.sh
pnpm run test-core # runs front-end + e2e tests against server (playwright)
pnpm run test-server # runs server tests (cargo test)
pnpm run serverd # start a bg server
pnpm run kill-serverd # kill background server
```

---

Airday Core is AGPL-3.0 licensed software.

Airday is designed to be a secure product. E2EE fields should not be compromised and user data should not be leaked. If you believe you have found a security issue, please disclose responsibility at support@air.day.
