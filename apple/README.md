# Airday on Apple

The Rust↔Swift FFI boundary for the Apple clients. This is layers 1 & 2 of
[`spec/swift-ffi-plan.md`](../spec/swift-ffi-plan.md): an **offline** capture/read
surface only — no sync, auth, HTTP, UI, or Keychain yet. The `SyncEngine` is not
exposed; that plumbing is a follow-up once the boundary is proven.

## Layering

```
airday-ffi (Rust staticlib)          core/ffi — uniffi object over Doc + sqlite storage + DEK
   → AirdayCoreFFI.xcframework        static libs (macOS/iOS/iOS-sim) + C headers
      → AirdayCore (SwiftPM)          generated Swift bindings + a thin facade
         → future Xcode app           consumes AirdayCore as a local package
```

The one exported object, `AirdayStore`, mirrors the CLI's `boot_doc`: it opens
`<dir>/airday.sqlite`, boots the `Doc` from persisted encrypted ops, and after
every mutation captures the fresh Loro delta into an encrypted oplog row so a
later reopen replays it. The DEK crosses the boundary as raw bytes — key storage
(Keychain) is the caller's problem.

## Prerequisites

- **Rust** with the Apple targets (the build script adds them for you):
  `aarch64-apple-darwin`, `aarch64-apple-ios`, `aarch64-apple-ios-sim`.
- **Full Xcode** (not just the Command Line Tools). `-create-xcframework` and
  `swift test`'s `XCTest` both need it. If `xcode-select -p` points at
  `CommandLineTools`, either `sudo xcode-select -s /Applications/Xcode.app` once,
  or prefix commands with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`.
  (`build-xcframework.sh` already falls back to `/Applications/Xcode.app` on its own.)

## The two commands

```sh
# 1. Build the XCFramework + generated Swift bindings from the Rust crate.
bun run build:apple            # == apple/build-xcframework.sh

# 2. Run the SwiftPM smoke test (open → mutate → read → reopen → assert).
swift test --package-path apple/AirdayCore
# on a CLT-default machine:
# DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --package-path apple/AirdayCore
```

`build:apple` is the **single** way to produce the two build outputs, both
gitignored:

- `apple/AirdayCore/AirdayCoreFFI.xcframework` — the static libs + headers.
- `apple/AirdayCore/Sources/AirdayCore/Generated/` — the uniffi Swift bindings.

Run it before `swift build` / `swift test` on a fresh checkout — the package
won't compile without those outputs present.
