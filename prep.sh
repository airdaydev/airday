#!/bin/bash
set -e

CONFIG_DIR=$HOME/.config/airday
mkdir -p $CONFIG_DIR
echo "export DATABASE_URL=sqlite:$CONFIG_DIR/airday.db" > .env
sqlx database reset -y
sqlx migrate run

pnpm install
