#!/usr/bin/env bash
# Install Brigid on a fresh Ubuntu or Debian machine.
#
# Does everything docs/deploy.md describes: packages, Node, pnpm, PostgreSQL, a
# database and role, the build, and a systemd unit that survives a reboot. Ends
# with a URL to open and an account to create.
#
# Safe to run twice. Every step checks for what it is about to do and skips it
# if it is already there, so a run that fails partway can be fixed and rerun
# without unpicking anything by hand.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$HERE"

PORT="${PORT:-8090}"
DB_NAME="${DB_NAME:-brigid}"
DB_USER="${DB_USER:-brigid}"
NODE_MAJOR=22
PNPM_VERSION=9.12.0

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31m!!! %s\033[0m\n' "$*" >&2; exit 1; }

# --- Checks before anything is changed -------------------------------------

[[ $EUID -ne 0 ]] || die "Run this as your own user, not as root. It will ask for sudo when it needs it."
command -v apt-get >/dev/null || die "This installer is for Ubuntu and Debian. See docs/deploy.md to do it by hand."
sudo -v || die "This needs sudo for packages, PostgreSQL, and the systemd unit."

say "Installing Brigid as $USER, from $HERE"
note "Port $PORT · database '$DB_NAME' · role '$DB_USER'"

# --- Packages ---------------------------------------------------------------

say "System packages"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl ca-certificates postgresql postgresql-contrib

# NodeSource only when the distribution's Node is too old, since adding a third
# party apt source is not something to do for no reason.
have_node=$( { node -v 2>/dev/null || echo v0; } | sed 's/^v\([0-9]*\).*/\1/' )
if [[ "$have_node" -lt "$NODE_MAJOR" ]]; then
  say "Node $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y -qq nodejs
else
  note "Node $(node -v) is new enough."
fi

if ! command -v pnpm >/dev/null; then
  say "pnpm"
  sudo npm install -g "pnpm@${PNPM_VERSION}"
else
  note "pnpm $(pnpm -v) already installed."
fi

# --- PostgreSQL -------------------------------------------------------------

say "PostgreSQL"
sudo systemctl enable --now postgresql
sudo -u postgres psql -tAc 'SELECT 1' >/dev/null || die "PostgreSQL is installed but not answering."

role_exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")
if [[ "$role_exists" == "1" ]]; then
  note "Role '$DB_USER' already exists; leaving its password alone."
  DB_PASS=""
else
  # Generated rather than asked for: nobody types this password, it goes
  # straight into a config file the app reads, and a generated one is better
  # than whatever gets chosen under time pressure.
  DB_PASS="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  sudo -u postgres psql -q <<SQL
CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
SQL
  note "Created role '$DB_USER' with a generated password."
fi

db_exists=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")
if [[ "$db_exists" == "1" ]]; then
  note "Database '$DB_NAME' already exists."
else
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
  note "Created database '$DB_NAME'."
fi

# gen_random_uuid() is used by nearly every table's primary key.
sudo -u postgres psql -q -d "$DB_NAME" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'

# --- Configuration ----------------------------------------------------------

say "Configuration"
if [[ -f .env.local ]]; then
  note ".env.local already exists; leaving it as it is."
  if [[ -n "$DB_PASS" ]]; then
    note "NOTE: a new database role was created but .env.local was not updated."
    note "      Add this line yourself:"
    note "      DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
  fi
else
  SESSION_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  {
    echo "# Written by install.sh. Safe to edit; nothing overwrites it."
    echo "PORT=${PORT}"
    echo "HOST=0.0.0.0"
    echo "SESSION_SECRET=${SESSION_SECRET}"
    if [[ -n "$DB_PASS" ]]; then
      echo "DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
    else
      echo "# The role already existed, so its password is not known here."
      echo "# DATABASE_URL=postgres://${DB_USER}:PASSWORD@localhost:5432/${DB_NAME}"
    fi
  } > .env.local
  chmod 600 .env.local
  note "Wrote .env.local (readable only by you — it holds the database password)."
fi

# --- Build ------------------------------------------------------------------

say "Installing dependencies"
pnpm install

say "Building the web app"
# apps/web/dist is gitignored, so without this every page is a bare 404 while
# the API itself answers perfectly — a confusing way to arrive.
pnpm build:web

say "Applying database migrations"
# The root script is db:migrate, and it reads DATABASE_URL from .env.local —
# which only exists at this point if a password was known. If the role already
# existed the writer has to supply it, and running migrations without it would
# fail in a way that reads like a broken install rather than a missing line.
if grep -qsE '^[[:space:]]*DATABASE_URL=' .env.local; then
  pnpm db:migrate || die "Migrations failed. Check DATABASE_URL in .env.local, then rerun this script."
else
  note "Skipped — no DATABASE_URL yet."
  note "Add it to .env.local, then run: pnpm db:migrate && sudo systemctl restart brigid"
fi

# --- systemd ----------------------------------------------------------------

say "systemd service"
# Resolved now rather than written as a bare name: systemd starts a non-login
# shell, so anything installed by nvm is not on its PATH. An absolute path is
# the one form that works in both cases.
PNPM_BIN="$(command -v pnpm)"
[[ -n "$PNPM_BIN" ]] || die "pnpm is not on PATH after installing it."

sudo tee /etc/systemd/system/brigid.service >/dev/null <<UNIT
[Unit]
Description=Brigid — self-hosted novel writing application
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${HERE}
ExecStart=${PNPM_BIN} start
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
# The checkout stays writable: data/brigid.config.json is written here on first
# boot and again when the setup wizard settles the database.
ReadWritePaths=${HERE}

StandardOutput=journal
StandardError=journal
SyslogIdentifier=brigid

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now brigid
sleep 3

if ! systemctl is-active --quiet brigid; then
  echo
  sudo journalctl -u brigid -n 30 --no-pager || true
  die "Brigid did not start. The last 30 log lines are above."
fi

# --- Done -------------------------------------------------------------------

if command -v ufw >/dev/null && sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
  sudo ufw allow "${PORT}/tcp" >/dev/null && note "Opened port ${PORT} in ufw."
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "Brigid is running."
echo
note "Open   http://${IP:-your-server}:${PORT}"
note "and create your account — the first visit sets it up."
echo
note "Logs     journalctl -u brigid -f"
note "Restart  sudo systemctl restart brigid"
note "Update   ./restart.sh"
echo
