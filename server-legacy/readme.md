# Airday server exploration

This is v0 of Airday's backend in Rust.

## Run tests
```bash
 # with stdout
cargo test -- --nocapture
```

## Additional deps to explore
- chrono (tz package, for calendar)
- chrono-tz (tz extension, for calendar)
- automerge (for text crdts)
- criterion = { version = "0.7", features = ["html_reports"] }
