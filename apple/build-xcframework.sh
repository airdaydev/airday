#!/usr/bin/env bash
#
# Build the AirdayCoreFFI XCFramework + Swift bindings from the
# `airday-ffi` Rust crate. This is the single source of the two build
# outputs the SwiftPM package (`apple/AirdayCore`) consumes:
#
#   apple/AirdayCore/AirdayCoreFFI.xcframework          (static libs + headers)
#   apple/AirdayCore/Sources/AirdayCore/Generated/*.swift  (uniffi bindings)
#
# Both are gitignored; this script is how you (re)produce them. Run from
# anywhere: `bun run build:apple` or `apple/build-xcframework.sh`.
#
# See spec/swift-ffi-plan.md (Milestone 2) and apple/README.md.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CRATE=airday-ffi
STATICLIB=libairday_ffi.a
DYLIB=libairday_ffi.dylib
NAMESPACE=airday_ffi            # uniffi namespace == crate lib name

PKG_DIR="$ROOT/apple/AirdayCore"
XCFRAMEWORK="$PKG_DIR/AirdayCoreFFI.xcframework"
GEN_SWIFT_DIR="$PKG_DIR/Sources/AirdayCore/Generated"

# macOS host first: its release cdylib is what uniffi library-mode bindgen
# reads metadata from. iOS device + simulator aren't consumed yet, but
# proving they compile now is cheap insurance (plan Milestone 2).
HOST_TARGET=aarch64-apple-darwin
TARGETS=("$HOST_TARGET" aarch64-apple-ios aarch64-apple-ios-sim)

# `xcodebuild -create-xcframework` needs full Xcode, not just the Command
# Line Tools. Respect an already-selected Xcode; otherwise fall back to
# /Applications/Xcode.app without requiring `sudo xcode-select`.
if ! xcodebuild -version >/dev/null 2>&1; then
  if [ -d /Applications/Xcode.app ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  else
    echo "error: -create-xcframework needs full Xcode (found only Command Line Tools)." >&2
    echo "       Install Xcode, or run: sudo xcode-select -s /Applications/Xcode.app" >&2
    exit 1
  fi
fi

echo ">> rustup targets"
for t in "${TARGETS[@]}"; do
  rustup target add "$t" >/dev/null
done

echo ">> building staticlib (release) for ${#TARGETS[@]} targets"
for t in "${TARGETS[@]}"; do
  echo "   - $t"
  cargo build -p "$CRATE" --release --target "$t"
done

# Generate the Swift bindings once, in library mode, from the host cdylib.
GEN_TMP="$(mktemp -d)"
HEADERS_TMP="$(mktemp -d)"
trap 'rm -rf "$GEN_TMP" "$HEADERS_TMP"' EXIT

echo ">> generating Swift bindings"
cargo run -q -p "$CRATE" --bin uniffi-bindgen -- \
  generate \
  --library "target/$HOST_TARGET/release/$DYLIB" \
  --language swift \
  --out-dir "$GEN_TMP"

# XCFramework header dirs want the modulemap named `module.modulemap`;
# uniffi emits `<namespace>FFI.modulemap`. The module *name* inside is
# unchanged, so the generated `.swift`'s `import ${NAMESPACE}FFI` still
# resolves. All three slices share the one generated header.
echo ">> assembling headers"
cp "$GEN_TMP/${NAMESPACE}FFI.h" "$HEADERS_TMP/"
cp "$GEN_TMP/${NAMESPACE}FFI.modulemap" "$HEADERS_TMP/module.modulemap"

echo ">> creating xcframework"
rm -rf "$XCFRAMEWORK"
xcargs=()
for t in "${TARGETS[@]}"; do
  xcargs+=(-library "target/$t/release/$STATICLIB" -headers "$HEADERS_TMP")
done
xcodebuild -create-xcframework "${xcargs[@]}" -output "$XCFRAMEWORK"

echo ">> installing generated bindings"
rm -rf "$GEN_SWIFT_DIR"
mkdir -p "$GEN_SWIFT_DIR"
cp "$GEN_TMP/${NAMESPACE}.swift" "$GEN_SWIFT_DIR/"

echo "done:"
echo "  $XCFRAMEWORK"
echo "  $GEN_SWIFT_DIR/${NAMESPACE}.swift"
