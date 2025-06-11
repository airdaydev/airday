#!/bin/bash
set -e

# Reset database
export DATABASE_URL="sqlite:/home/daniel/.config/airday/test.db"
sqlx database reset -y --source=./server/migrations

# Start server in background
cargo run --manifest-path ./server/Cargo.toml -- --sqlx-host=sqlite:/home/daniel/.config/airday/test.db --config=./server/config.toml & SERVER_PID=$!

# Wait for server to be ready (adjust URL/port as needed)
# echo "Waiting for server to start..."
# while ! curl -s http://localhost:8080/health > /dev/null 2>&1; do
#     sleep 0.5
# done

# Run tests
set +e # disable on error
pnpm --dir ./packages/client test
TEST_EXIT_CODE=$?
set -e

# Cleanup: kill the server
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo "Tests completed, server stopped"

exit $TEST_EXIT_CODE
