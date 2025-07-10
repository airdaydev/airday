## Airday

[Airday](https://air.day/) calender & tasks app monorepo

## Directories
- ./flatbuffers: Protocol definitions and code gen
- ./ios: iOS app placeholder
- ./packages: JavaScript packages
- ./sqlite: Sqlite migration & notes
- ./web: Web based application
- ./server: Rust based server

## Development requirements
- Rust
- Bun
- pnpm
- sqlx-cli: (`cargo install sqlx-cli`)
- flatbuffers (flatc cli)

## Start
```bash
./prep.sh # sets up database, config, downloads js deps, etc
pnpm run test # runs all tests
```

---

Airday is designed to be a secure product where user text data is end-to-end encrypted, keys are secured and data does not leak. If you believe you have found a security issue, please disclose responsibility at support@air.day.

Airday is BSL-licensed software. You may self-host it for your own personal or own small team use for free. For commercial deployments, please contact support@air.day.
