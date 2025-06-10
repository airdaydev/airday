# Airday server exploration

This is v0 of Airday's backend in Rust.

## Development
```bash
pacman -Sy sqlite
cargo install sqlx-cli
cargo run

mkdir ~/.config/airday
echo "DATABASE_URL=sqlite:/home/daniel/.config/airday/airday.db" > .env
# or export DATABASE_URL=sqlite:~/.config/airday/airday.db
sqlx database create
sqlx database reset
sqlx migrate run

sqlite3 /home/daniel/.config/airday/airday.db
.databases
.tables
SELECT name, type, sql FROM sqlite_master;
```

## Additional deps to explore
- serde (serialisation, deserialisation)
- chrono (tz package)
- chrono-tz (tz extension?)
- validator (validate requests)
- uuid (id generation)
- automerge (maybe, crdt lib)
- clap (maybe, command line parser)
