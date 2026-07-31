#!/usr/bin/env bash
# Stop the systemd service, pull the latest, reinstall, migrate, and start again.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

echo "==> Stopping brigid…"
sudo systemctl stop brigid || true

echo "==> Pulling latest…"
git pull --ff-only

echo "==> Installing dependencies…"
pnpm install

echo "==> Applying database migrations…"
# No-op before the setup wizard has established a database.
if [ -f data/brigid.config.json ] || [ -n "${DATABASE_URL:-}" ]; then
  pnpm db:migrate
else
  echo "    (skipped — no database configured yet)"
fi

echo "==> Starting brigid…"
sudo systemctl start brigid
sleep 1
sudo systemctl status brigid --no-pager
