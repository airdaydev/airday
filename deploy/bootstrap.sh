#!/bin/bash
# Bootstrap a fresh Debian 13 server for Monoplan.
# Run as root on the box:
#   ssh root@<ip> 'bash -s' < deploy/bootstrap.sh
#
# Idempotent — safe to re-run after fiddling. Does NOT install a deploy
# key for the repo clone; add one out of band before running this if the
# repo is private.

set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:danielgormly/airday.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
BASE_DIR="/opt/monoplan"
SOURCE_DIR="$BASE_DIR/source"
RELEASES_DIR="$BASE_DIR/releases"
CURRENT_LINK="$BASE_DIR/current"
CARGO_TARGET_DIR="$BASE_DIR/cargo-target"
DATA_DIR="/var/lib/monoplan"
ETC_DIR="/etc/monoplan"

echo "==> Updating apt + base packages"
apt-get update && apt-get upgrade -y
apt-get install -y unzip git build-essential curl sudo rsync libssl-dev pkg-config ca-certificates

echo "==> Installing Rust (system-wide via root toolchain)"
if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
fi
. "$HOME/.cargo/env"

# Install Rustwasm
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

echo "==> Installing Caddy (xcaddy build, no DNS-challenge plugins needed)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-xcaddy-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/xcaddy/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-xcaddy.list
  apt-get update
  apt-get install -y xcaddy
  ( cd /tmp && xcaddy build && mv caddy /usr/local/bin/ )
fi

echo "==> Configuring firewall"
apt-get install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Hardening SSH"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

echo "==> Installing fail2ban"
apt-get install -y fail2ban
systemctl enable fail2ban
systemctl start fail2ban

echo "==> Installing Bun (system-wide)"
if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.com/install | bash
  mv /root/.bun/bin/* /usr/local/bin/
  ln -sfn /usr/local/bin/bun /usr/local/bin/bunx
fi
bun --version

echo "==> Creating monoplan user"
if ! id -u monoplan >/dev/null 2>&1; then
  useradd -m -s /bin/bash monoplan
fi
cat >/etc/sudoers.d/monoplan <<'EOF'
monoplan ALL=(root) NOPASSWD: /bin/systemctl daemon-reload
monoplan ALL=(root) NOPASSWD: /bin/systemctl restart caddy.service
monoplan ALL=(root) NOPASSWD: /bin/systemctl restart monoplan.service
EOF
chmod 440 /etc/sudoers.d/monoplan

echo "==> Cloning repo"
mkdir -p "$SOURCE_DIR" "$RELEASES_DIR" "$(dirname "$CARGO_TARGET_DIR")"
if [ ! -d "$SOURCE_DIR/.git" ]; then
  # First clone runs as root because the deploy key is typically in
  # /root/.ssh; chown afterwards so the monoplan user owns subsequent
  # fetches.
  git clone -b "$REPO_BRANCH" "$REPO_URL" "$SOURCE_DIR"
fi
chown -R monoplan:monoplan "$BASE_DIR"
touch "$BASE_DIR/.env"
chown monoplan:monoplan "$BASE_DIR/.env"
chmod 600 "$BASE_DIR/.env"

echo "==> Creating data + config dirs"
mkdir -p "$DATA_DIR" "$ETC_DIR"
chown -R monoplan:monoplan "$DATA_DIR"
chown root:monoplan "$ETC_DIR"
chmod 0750 "$ETC_DIR"

echo "==> Installing systemd units"
ln -sfn "$SOURCE_DIR" "$CURRENT_LINK"
install -m 0644 "$SOURCE_DIR/deploy/systemd/monoplan.service" /etc/systemd/system/monoplan.service
install -m 0644 "$SOURCE_DIR/deploy/systemd/caddy.service" /etc/systemd/system/caddy.service
systemctl daemon-reload
systemctl enable monoplan.service
systemctl enable caddy.service

cat <<'EOF'

==> Bootstrap complete.

Next steps:
  1. cp /opt/monoplan/source/js/config/.env.deploy.example /opt/monoplan/.env
     and fill in MONOPLAN_HOST + CADDY_EMAIL (mode 0600, owned by monoplan).
  2. Make sure DNS for MONOPLAN_HOST points at this box (Caddy uses HTTP-01).
  3. Run the first deploy as the monoplan user:
       sudo -u monoplan bash /opt/monoplan/source/deploy/ci.sh
  4. Watch:  journalctl -u monoplan -u caddy -f

EOF
