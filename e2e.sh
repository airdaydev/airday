#!/bin/bash
set -e

# Start jaeger if not started
# pnpm run jaeger

## Offline package tests
pnpm run --dir js/cal test --run
pnpm run --dir js/list test --run
pnpm run --dir js/tracer test --run

# Database setup
DATABASE_PATH="$HOME/.config/airday/test.db"
export DATABASE_URL="sqlite:$DATABASE_PATH"

## Server tests
sqlx database reset -y --source sqlite/migrations
pnpm run test-server

# Start server in background
sqlx database reset -y --source sqlite/migrations
cargo run --manifest-path ./server/Cargo.toml -- \
  --sqlx-host=$DATABASE_URL \
  --log-level=OFF \
  --config=./server/config.toml & SERVER_PID=$!

# Wait for server to be ready (adjust URL/port as needed)
echo "Waiting for server to start..."
while ! curl -s http://localhost:3000/ > /dev/null 2>&1; do
    sleep 0.5
done

# Run tests
set +e # disable exit on error
pnpm --dir ./js/core test
TEST_EXIT_CODE=$?
set -e # enable exit on error

# Cleanup server
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "Tests completed with code $TEST_EXIT_CODE, server stopped"
echo "sqlite3 $DATABASE_PATH"

exit $TEST_EXIT_CODE
