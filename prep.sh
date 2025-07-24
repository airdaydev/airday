#!/bin/bash
set -e

CONFIG_DIR=$HOME/.config/airday
mkdir -p $CONFIG_DIR
echo "export DATABASE_URL=sqlite:$CONFIG_DIR/airday.db" > .env
sqlx database reset -y --source sqlite/migrations
envsubst < server/config_templates/config.toml > ./server/config.toml
./flatbuffers/compile.sh

pnpm install
