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
pnpm run test-server

# Run tests
set +e # disable exit on error
pnpm --dir ./js/core test
TEST_EXIT_CODE=$?
set -e # enable exit on error

# Cleanup server
pkill -f airday || true

echo "Tests completed with code $TEST_EXIT_CODE, server stopped"
echo "sqlite3 $DATABASE_PATH"

exit $TEST_EXIT_CODE
