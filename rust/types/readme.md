# Common type defs

Define in RS, get back in TS

TODO: Scrub this in favour of macro-generated versions
Quick & dirty version

## Established libraries
- ts_rs: poor enum support (doesn't allow specified ints)
- specta: in between major versions (Use for extracted sync engine)
- typeshare: dirty and good enough for release

## typeshare
```bash
cargo install typeshare-cli
typeshare ./container/test.rs --lang=typescript --output-file=container.ts
typeshare ./item/lib.rs --lang=typescript --output-file=item.ts
```
