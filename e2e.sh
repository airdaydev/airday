#!/bin/bash
set -e

# Reset database
DATABASE_PATH="$HOME/.config/airday/test.db"
export DATABASE_URL="sqlite:$DATABASE_PATH"
sqlx database reset -y --source sqlite/migrations

## Database tests
pnpm run test-server
sqlx database reset -y --source sqlite/migrations

## Package tests
pnpm run --dir packages/cal test --run
pnpm run --dir packages/list test --run
pnpm run --dir packages/tracer test --run

# Start server in background
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
pnpm --dir ./packages/core test
TEST_EXIT_CODE=$?
set -e # enable exit on error

# Cleanup server
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "Tests completed with code $TEST_EXIT_CODE, server stopped"
echo "sqlite3 $DATABASE_PATH"

exit $TEST_EXIT_CODE
