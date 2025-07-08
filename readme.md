## Airday

[Airday](https://air.day/) calender & tasks app monorepo

## Development
- ./server: Rust based server
- ./web: Web based application

## Requirements
- Rust
- Node
- Bun
- pnpm
- `cargo install sqlx-cli`
- flatbuffers

## Start
```bash
./prep.sh
./e2e.sh # Runs e2e tests via JSClient against server & test db
```
