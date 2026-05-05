# Airday

[Airday](https://air.day/) is an e2ee, realtime, tasks app i.e. todo list with conflict resolution backed by Loro.

⚠️ ATTN: Airday is undergoing extensive and frequent changes, it is not ready to use.

## Saas vs Self-hosted
This is the private repo currently containing everything. We will extract most of this repo into a public repo prior to release.

```
📁 monorepo
├── 📂 cli  → CLI app
├── 📂 ios          → iOS app placeholder
├── 📂 js           → JavaScript packages
├── 📂 crates         → Rust packages
├── 📂 server       → Server
├── 📂 sqlite       → Sqlite migration & notes
└── 📂 telemetry    → Jaeger & OTLP collector for dev envs (may upgrade to clickstack)
```

## Development Requirements
- Rust
- Bun
- sqlx-cli: (`cargo install sqlx-cli`)
- flatbuffers (flatc cli)

## Development Setup (MacOS & Arch Linux)
```bash
sudo systemctl start docker # if not started
bun run jaeger # to get tracing (system tests rely on this currently)
./prep.sh # sets up database, config, downloads js deps, etc
bun run test # runs ALL tests aka ./test.sh
bun run test-core # runs front-end + e2e tests against server (playwright)
bun run test-server # runs server tests (cargo test)
bun run serverd # start a bg server
bun run kill-serverd # kill background server
```

---

Airday Core is AGPL-3.0 licensed software.

Airday is designed to be a secure product. E2EE fields should not be compromised and user data should not be leaked. If you believe you have found a security issue, please disclose responsibility at support@air.day.
