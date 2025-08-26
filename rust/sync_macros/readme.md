# sync types exploration

The end game is to have a macro that takes sync_object schemas and builds Rust data structures that adhere to traits for use in sync engine, as well as export Typescript types.

## Established Rust libraries for type export
- ts_rs: poor enum support (doesn't allow specified ints)
- specta: in between major versions (Use for extracted sync engine?)
- typeshare: dirty and good enough for release? tho i can't seem to have it as an optional macro
- tslink: haven't tried

## Caveat: consts > enums
None of the above libraries export Enums with int unions as Typescript enums mapped to ints defined in rust. const is therefore preferable for TS generation

## typeshare
```bash
cargo install typeshare-cli
typeshare ./container/test.rs --lang=typescript --output-file=container.ts
typeshare ./src/lib.rs --lang=typescript --output-file=item.ts
```

## specta
