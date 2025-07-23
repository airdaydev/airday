# Airday

[Airday](https://air.day/) calendar & tasks app monorepo

```
📁 monorepo
├── 📂 flatbuffers  → Protocol definitions and code gen
├── 📂 ios          → iOS app placeholder
├── 📂 js           → JavaScript packages
├── 📂 rust         → Rust packages
├── 📂 server       → Rust based server
├── 📂 sqlite       → Sqlite migration & notes
├── 📂 telemetry    → Jaeger & OTLP collector for dev envs
├── 📂 web          → Web based application
```

## Self-hosting
Coming soon

## Development Requirements
- Rust
- Bun
- pnpm
- sqlx-cli: (`cargo install sqlx-cli`)
- flatbuffers (flatc cli)

## Development Setup
```bash
./prep.sh # sets up database, config, downloads js deps, etc
pnpm run test # runs all tests
```

---

Airday is designed to be a secure product. E2E encrypted fields should not be compromised and user data should not be leaked. If you believe you have found a security issue, please disclose responsibility at support@air.day.

Airday is BSL-licensed software. You may self-host it for your own personal or own small team use for free.
