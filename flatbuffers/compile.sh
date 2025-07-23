#!/bin/bash

set -euo pipefail
WORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
flatc --ts -o $WORK_DIR/../js/core/src/ $WORK_DIR/proto.fbs
flatc --rust -o $WORK_DIR/../server/src/sync/ $WORK_DIR/proto.fbs
flatc --swift -o $WORK_DIR/../ios/ $WORK_DIR/proto.fbs
echo Compiled flatbuffers for ts, rust and swift
