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

## SQLite tooling
```bash
pacman -Sy sqlite
sqlx database reset --source sqlite/migrations # drops, creates db & runs migrations
sqlite3 $HOME/.config/airday/airday.db
.databases
.tables
SELECT name, type, sql FROM sqlite_master;
```

## Start
```bash
./prep.sh
./e2e.sh # Runs e2e tests via JSClient against server & test db
```
