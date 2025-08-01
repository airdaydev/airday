#!/bin/bash
set -ex

WORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$WORK_DIR/serverd.log"
source $WORK_DIR/.env

echo "killing existing airday servers"
pkill -f airday || true

sqlx database reset -y --source sqlite/migrations
cargo run --manifest-path $WORK_DIR/server/Cargo.toml -- \
  --sqlx-host=$DATABASE_URL \
  --log-level=DEBUG \
  --config=./server/config.toml > $LOG_FILE 2>&1 &
export AIRDAY_PID=$!

# Wait for server to be ready (adjust URL/port as needed)
while ! curl -s http://localhost:3000/ > /dev/null 2>&1; do
    sleep 0.5
done

echo "Airday server ready at pid=$AIRDAY_PID, log_file=$LOG_FILE"
