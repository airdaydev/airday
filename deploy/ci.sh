#!/bin/bash
# Build a release on the box and flip the `current` symlink to it.
# Run as the airday user (locally over ssh, or from a CI runner with
# sudo'd `systemctl restart` rights — see deploy/bootstrap.sh).

set -euo pipefail

BASE_DIR="/opt/airday"
SOURCE_DIR="$BASE_DIR/source"
RELEASES_DIR="$BASE_DIR/releases"
CURRENT_LINK="$BASE_DIR/current"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$BASE_DIR/.env}"
DEPLOY_REF="${DEPLOY_REF:-origin/main}"
ETC_DIR="/etc/airday"

export CARGO_TARGET_DIR="$BASE_DIR/cargo-target"
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

if [ ! -d "$SOURCE_DIR/.git" ]; then
  echo "Missing git checkout at $SOURCE_DIR — run deploy/bootstrap.sh first" >&2
  exit 1
fi

if [ ! -f "$DEPLOY_ENV_FILE" ]; then
  echo "Missing deploy env file at $DEPLOY_ENV_FILE" >&2
  echo "Copy js/config/.env.deploy.example into place and fill it in." >&2
  exit 1
fi

echo "==> Updating source checkout"
cd "$SOURCE_DIR"
git fetch --prune origin
git reset --hard "$DEPLOY_REF"
git clean -fdx

COMMIT_SHA="$(git rev-parse HEAD)"
COMMIT_SHORT_SHA="$(git rev-parse --short HEAD)"
RELEASE_ID="$(date +%Y%m%d-%H%M%S)-$COMMIT_SHORT_SHA"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_ID"

echo "==> Creating release $RELEASE_ID from $COMMIT_SHA"
mkdir -p "$RELEASES_DIR"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
rsync -a \
  --delete \
  --exclude '.git' \
  --exclude '.github' \
  --exclude '.DS_Store' \
  "$SOURCE_DIR/" "$RELEASE_DIR/"

cd "$RELEASE_DIR"

echo "==> Staging deploy config input"
install -m 0600 "$DEPLOY_ENV_FILE" "$RELEASE_DIR/js/config/.env"

echo "==> Installing JS deps"
bun install --frozen-lockfile

echo "==> Rendering deploy config"
bun run config:deploy

echo "==> Building wasm core for web"
bun run build:wasm:web

echo "==> Building web bundle"
( cd js/web && bun run build )

echo "==> Building airday-server"
cargo build --release -p airday-server

# Cargo writes the binary into the shared CARGO_TARGET_DIR, but the
# systemd unit (and the Caddyfile, indirectly) reference paths under
# /opt/airday/current — so stage the binary inside the release tree.
install -Dm755 \
  "$CARGO_TARGET_DIR/release/airday-server" \
  "$RELEASE_DIR/target/release/airday-server"

echo "==> Installing rendered server config to $ETC_DIR"
install -m 0640 -o airday -g airday \
  "$RELEASE_DIR/deploy/rendered/server.toml" "$ETC_DIR/server.toml"

echo "==> Flipping current symlink"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

echo "==> Restarting services"
sudo systemctl restart airday.service
sudo systemctl restart caddy.service

# Best-effort prune: keep last 5 releases. Older ones are safe to drop —
# the binary and rendered config in /etc are already copied out.
echo "==> Pruning old releases (keep last 5)"
ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf

echo "==> Done. Release: $RELEASE_ID"
