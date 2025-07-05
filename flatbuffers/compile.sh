#!/bin/bash

set -euo pipefail
WORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
flatc --ts --ts-omit-entrypoint -o $WORK_DIR/../packages/core/src/ $WORK_DIR/airday.fbs
flatc --rust --rust-serialize -o $WORK_DIR/../server/src/sync/ $WORK_DIR/airday.fbs
