#!/usr/bin/env bash
# Install Brigid on macOS.
#
# The counterpart to install.sh, which is Ubuntu and Debian only. Kept as a
# separate script rather than as branches inside that one: almost every step
# differs — Homebrew rather than apt, no `postgres` system account, launchd
# rather than systemd — so a combined script would be a branch at every line and
# the Ubuntu path is the one running most people's manuscript.
#
# Safe to run twice. Every step checks for what it is about to do.
set -euo pipefail

HERE="$(cd "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")" && pwd)"
cd "$HERE"

PORT="${PORT:-8090}"
DB_NAME="${DB_NAME:-brigid}"
PG_FORMULA="${PG_FORMULA:-postgresql@16}"
PLIST="/Library/LaunchDaemons/com.brigid.app.plist"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31m!!! %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "This is the macOS installer. On Ubuntu or Debian use ./install.sh"
[[ $EUID -ne 0 ]] || die "Run this as yourself, not with sudo. It asks for sudo only when it needs it."

say "Installing Brigid as $USER, from $HERE"
note "Port $PORT · database '$DB_NAME'"

# --- Homebrew ---------------------------------------------------------------

if ! command -v brew >/dev/null; then
  say "Homebrew"
  note "Not installed. Install it from https://brew.sh and run this again."
  die "Homebrew is required."
fi
# Apple silicon puts brew in /opt/homebrew, which is not on a default PATH.
eval "$("$(command -v brew)" shellenv)"

say "Packages"
for formula in node pnpm "$PG_FORMULA"; do
  if brew list --versions "$formula" >/dev/null 2>&1; then
    note "$formula already installed."
  else
    brew install "$formula"
  fi
done

# Versioned Postgres formulae are keg-only: their binaries are not linked into
# the prefix, so psql and createdb have to be found where brew put them.
PG_BIN="$(brew --prefix "$PG_FORMULA")/bin"
[[ -d "$PG_BIN" ]] || die "Cannot find $PG_FORMULA binaries. Is the formula name right?"
export PATH="$PG_BIN:$PATH"

# --- PostgreSQL -------------------------------------------------------------

say "PostgreSQL"
brew services start "$PG_FORMULA" >/dev/null 2>&1 || true

# It takes a moment to accept connections, and failing here would look like a
# broken install rather than an impatient one.
for _ in $(seq 1 20); do
  psql -d postgres -tAc 'SELECT 1' >/dev/null 2>&1 && break
  sleep 1
done
psql -d postgres -tAc 'SELECT 1' >/dev/null 2>&1 || die "PostgreSQL did not come up. Try: brew services restart $PG_FORMULA"

# No role is created. Homebrew's Postgres runs as the account that installed it
# and makes that account a superuser, so there is already a login that owns
# everything — unlike Debian, where the packaging convention is a separate
# `postgres` system account and a role has to be made. A second role here would
# mean managing a password for no gain.

if psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  note "Database '$DB_NAME' already exists."
else
  createdb "$DB_NAME"
  note "Created database '$DB_NAME', owned by $USER."
fi

psql -q -d "$DB_NAME" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'

# --- Configuration ----------------------------------------------------------

say "Configuration"
if [[ -f .env.local ]]; then
  note ".env.local already exists; leaving it alone."
else
  SESSION_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  {
    echo "# Written by install-macos.sh. Safe to edit; nothing overwrites it."
    echo "PORT=${PORT}"
    echo "HOST=0.0.0.0"
    echo "SESSION_SECRET=${SESSION_SECRET}"
    # No password: local connections authenticate as the Unix user, which is
    # already the owner of this database.
    echo "DATABASE_URL=postgres://${USER}@localhost:5432/${DB_NAME}"
  } > .env.local
  chmod 600 .env.local
  note "Wrote .env.local"
fi

# --- Build ------------------------------------------------------------------

say "Installing dependencies"
pnpm install

say "Building the web app"
pnpm build:web

say "Applying database migrations"
pnpm db:migrate || die "Migrations failed. Check DATABASE_URL in .env.local, then rerun."

# --- launchd ----------------------------------------------------------------

say "Starting at boot"
# A LaunchDaemon rather than a LaunchAgent: an agent only runs while its user is
# logged in, so a Mac left at the login screen after a restart would have no
# Brigid on it — which is exactly when you would want it.
PNPM_BIN="$(command -v pnpm)"
NODE_DIR="$(dirname "$(command -v node)")"

sudo tee "$PLIST" >/dev/null <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.brigid.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>${PNPM_BIN}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key><string>${HERE}</string>
  <key>UserName</key><string>${USER}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PATH</key><string>${NODE_DIR}:${PG_BIN}:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>${HERE}/data/brigid.log</string>
  <key>StandardErrorPath</key><string>${HERE}/data/brigid.log</string>
</dict>
</plist>
PLISTXML

sudo chown root:wheel "$PLIST"
sudo chmod 644 "$PLIST"
mkdir -p data

sudo launchctl bootout system "$PLIST" 2>/dev/null || true
sudo launchctl bootstrap system "$PLIST"
sleep 3

if ! curl -fsS "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
  echo
  tail -n 30 data/brigid.log 2>/dev/null || true
  die "Brigid did not answer on port ${PORT}. The last log lines are above."
fi

# --- Done -------------------------------------------------------------------

IP="$(ipconfig getifaddr en0 2>/dev/null || echo localhost)"
say "Brigid is running."
echo
note "Open   http://localhost:${PORT}"
note "or     http://${IP}:${PORT}  from another machine on your network"
note "and create your account — the first visit sets it up."
echo
note "Logs     tail -f ${HERE}/data/brigid.log"
note "Restart  sudo launchctl kickstart -k system/com.brigid.app"
note "Stop     sudo launchctl bootout system ${PLIST}"
echo
