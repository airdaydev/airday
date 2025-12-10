#!/bin/bash

set -euo pipefail
WORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_DIR="$WORK_DIR/../js/core/src"
RS_DIR="$WORK_DIR/../server/src/sync"
rm -rf $JS_DIR/proto
rm -rf $RS_DIR/proto_generated.rs
flatc --ts -o $JS_DIR/ $WORK_DIR/proto.fbs
flatc --rust -o $RS_DIR/ $WORK_DIR/proto.fbs
echo Compiled Flatbuffers for Typescript and Rust
