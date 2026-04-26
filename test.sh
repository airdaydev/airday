#!/bin/bash
set -e

# Start jaeger if not started
# bun run jaeger

## Offline package tests
bun run --cwd js/cal test --run
bun run --cwd js/list test --run
bun run --cwd js/tracer test --run

# Database setup
DATABASE_PATH="$HOME/.config/airday/test.db"
export DATABASE_URL="sqlite:$DATABASE_PATH"

## Server tests
bun run db # Note will reset test db
bun run test-server

# Run tests
set +e # disable exit on error
bun run --cwd ./js/core browser
bun run --cwd ./js/core test
TEST_EXIT_CODE=$?
set -e # enable exit on error

# Cleanup server
pkill -f airday || true

echo "Tests completed with code $TEST_EXIT_CODE, server stopped"
echo "sqlite3 $DATABASE_PATH"

exit $TEST_EXIT_CODE
