#!/usr/bin/env bash
# Runs on the game instance (as root, via SSM) after the checkout at /opt/tuff-game has been
# reset to the branch being deployed. Builds IRONWILD and points tuff-game.service at it.
set -euo pipefail

APP_DIR=/opt/tuff-game
SERVICE=tuff-game.service
DROPIN_DIR=/etc/systemd/system/$SERVICE.d

as_tuff() { sudo -u tuff env HOME="$APP_DIR" "$@"; }

cd "$APP_DIR"

echo "== Unit before deploy"
systemctl cat "$SERVICE" || true

echo "== Install and build"
as_tuff npm ci
as_tuff npm run ironwild:build

NODE_BIN=$(as_tuff sh -c 'command -v node')
echo "node: $NODE_BIN ($("$NODE_BIN" --version))"

echo "== Point $SERVICE at IRONWILD"
mkdir -p "$DROPIN_DIR"
cat > "$DROPIN_DIR/ironwild.conf" <<EOF
[Service]
WorkingDirectory=$APP_DIR
ExecStart=
ExecStart=$NODE_BIN $APP_DIR/ironwild/server/dist/main.js
Environment=IRONWILD_TRUST_PROXY=1
EOF
systemctl daemon-reload
systemctl restart "$SERVICE"

echo "== Health check"
sleep 10
systemctl --no-pager status "$SERVICE" || true
journalctl -u "$SERVICE" -n 40 --no-pager || true
if ! systemctl is-active --quiet "$SERVICE"; then
  echo "$SERVICE is not running after restart"
  exit 1
fi
PORT=$(systemctl show -p Environment --value "$SERVICE" | tr ' ' '\n' | sed -n 's/^PORT=//p')
PORT=${PORT:-7780}
curl -fsS -o /dev/null -w "GET http://127.0.0.1:$PORT/ -> %{http_code}\n" "http://127.0.0.1:$PORT/"
