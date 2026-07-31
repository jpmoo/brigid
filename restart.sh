#!/usr/bin/env bash
# Stop the systemd service, pull the latest, reinstall, migrate, and start again.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

# If any step below fails, don't walk away leaving Brigid stopped.
trap 'echo "==> FAILED — bringing brigid back up on the previous state"; sudo systemctl start brigid || true' ERR

echo "==> Stopping brigid…"
sudo systemctl stop brigid || true

echo "==> Pulling latest…"
git pull --ff-only

echo "==> Installing dependencies…"
pnpm install

echo "==> Applying database migrations…"
# DATABASE_URL usually lives in .env.local rather than the shell environment,
# and after first-run setup it lives in data/brigid.config.json. Check all three
# so a configured instance never silently skips its migrations.
if [ -f data/brigid.config.json ] ||
   [ -n "${DATABASE_URL:-}" ] ||
   grep -qsE '^[[:space:]]*DATABASE_URL=' .env.local .env; then
  pnpm db:migrate
else
  echo "    (skipped — no database configured yet)"
fi

echo "==> Starting brigid…"
sudo systemctl start brigid
sleep 1
sudo systemctl status brigid --no-pager
