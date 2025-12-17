#!/bin/bash

set -euo pipefail
WORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Sync concerns
JS_DIR="$WORK_DIR/../js/core/src/proto"
RS_DIR="$WORK_DIR/../server/src/sync"
# Clean up
rm -rf $JS_DIR/
rm -rf $RS_DIR/sync_generated.rs
# Create
mkdir -p $JS_DIR
flatc --ts -I $WORK_DIR -o $JS_DIR/ $WORK_DIR/sync.fbs $WORK_DIR/airday.fbs $WORK_DIR/common.fbs
flatc --rust -I $WORK_DIR -o $RS_DIR/ $WORK_DIR/sync.fbs $WORK_DIR/common.fbs

echo Compiled Flatbuffers for Typescript and Rust
