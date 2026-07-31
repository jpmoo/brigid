# Deploying Brigid on Ubuntu

Target: a headless Ubuntu server, PostgreSQL 13+, Brigid on **port 8090**,
surviving reboots via systemd.

Paths below assume the checkout is at `~/brigid`. Adjust if yours differs.

Paths below assume the checkout is at `~/brigid`. Adjust if yours differs.


---

## 1. Prerequisites

```bash
sudo apt update
sudo apt install -y git curl postgresql
```

Node 22, from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

pnpm:

```bash
sudo npm install -g pnpm@9.12.0
```

> Install Node system-wide rather than through nvm. nvm puts Node under your
> home directory and only initialises in interactive shells, so systemd won't
> find it. If you're already committed to nvm, see the note in step 5.

Confirm:

```bash
node -v && pnpm -v && psql --version
```

---

## 2. Clone into the existing directory

The repo is public, so no credentials, deploy key, or token is needed — plain
HTTPS works and unattended `git pull` keeps working.

`git clone` refuses to write into a directory that already has files in it, so
which command you want depends on what's already there.

**If the directory is empty** — clone into `.`:

```bash
cd ~/brigid
git clone https://github.com/jpmoo/brigid.git .
```

**If the directory already has files** you want to keep — attach a repo to it
instead of cloning:

```bash
cd ~/brigid
git init -b main
git remote add origin https://github.com/jpmoo/brigid.git
git fetch origin
git checkout -t origin/main
```

That last command fails if any incoming file would overwrite an existing one.
Either move the conflicting file aside, or, to take the repo's version wholesale:

```bash
git reset --hard origin/main
```

> `git reset --hard` discards local changes to tracked files. Check `git status`
> first if you're unsure what's there.

Install dependencies and build the web app:

```bash
cd ~/brigid
pnpm install
pnpm build:web
```

`apps/web/dist` is gitignored, so each server builds its own copy. Skip the build
and the API still works, but every page in the browser returns a bare 404.

---

## 3. Configure

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```bash
PORT=8090
HOST=0.0.0.0
APP_ORIGIN=http://your-server-hostname:8090
SECURE_COOKIES=0
```

`APP_ORIGIN` is how you'll reach the app in a browser — scheme and host, no
trailing path. Set `SECURE_COOKIES=1` only once you're serving over HTTPS;
setting it while on plain HTTP makes the browser drop the login cookie.

### Create the database

On Ubuntu the `postgres` superuser authenticates by unix-socket peer auth and
usually has no TCP password, which is exactly what Brigid's automatic
provisioning would need. Creating the role and database by hand is one command
and avoids loosening `pg_hba.conf`:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE brigid WITH LOGIN PASSWORD 'pick-a-strong-password';
CREATE DATABASE brigid OWNER brigid;
SQL

sudo -u postgres psql -d brigid <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT ALL ON SCHEMA public TO brigid;
SQL
```

Add the connection string to `.env.local`:

```bash
DATABASE_URL=postgres://brigid:pick-a-strong-password@localhost:5432/brigid
```

Leave `SESSION_SECRET` unset — Brigid generates one on first boot and persists
it to `data/brigid.config.json` (mode 0600, gitignored).

Nothing secret ever belongs in the repo: `.env.local` and `data/` are both
gitignored, which matters more now that the repo is public.

---

## 4. First start and account creation

```bash
cd ~/brigid
pnpm start
```

Migrations run automatically at boot when `DATABASE_URL` is set. In another
shell, confirm it's up and still expecting setup:

```bash
curl -s http://127.0.0.1:8090/api/health
curl -s http://127.0.0.1:8090/api/setup/status
```

You want `{"ok":true,"database":true}` and `{"needsSetup":true}`.

Now open `http://your-server-hostname:8090` in a browser. Because no account
exists yet, Brigid serves the first-run setup screen. Choose **Use existing**,
paste the same connection string from step 3, and create your account — at least
10 characters. Submitting it migrates, creates the account, and signs you in, so
you land straight in the library.

Setup closes permanently at that point; `/api/setup/*` refuses every further
call. Confirm and stop the foreground server with Ctrl-C:

```bash
curl -s http://127.0.0.1:8090/api/setup/status   # {"needsSetup":false}
```

> If the browser can't reach the box yet, see "Open the port" in step 5 — or do
> setup over `curl` instead:
>
> ```bash
> curl -sS -X POST http://127.0.0.1:8090/api/setup/complete -H 'content-type: application/json' -d '{"database":{"mode":"existing","url":"postgres://brigid:pick-a-strong-password@localhost:5432/brigid"},"account":{"username":"jpmoo","password":"your-password-here"}}'
> ```

---

## 5. systemd

A unit file can't expand `~`, `$HOME`, or anything on your PATH, so rather than
copying the template in `deploy/brigid.service` and editing four fields by hand,
generate it with those values already substituted. Run this from the checkout:

```bash
sudo tee /etc/systemd/system/brigid.service >/dev/null <<EOF
[Unit]
Description=Brigid — self-hosted novel writing application
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/brigid
ExecStart=$(command -v pnpm) start
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=$HOME/brigid

StandardOutput=journal
StandardError=journal
SyslogIdentifier=brigid

[Install]
WantedBy=multi-user.target
EOF
```

The heredoc is unquoted on purpose: `$USER`, `$HOME`, and `$(command -v pnpm)`
expand in your shell as it's written, so the unit lands with real absolute
values. Check them before enabling:

```bash
grep -E 'User=|WorkingDirectory=|ExecStart=|ReadWritePaths=' /etc/systemd/system/brigid.service
```

Note there's no `ProtectHome=` here. The checkout lives under `/home`, and
`ProtectHome=read-only` would make `data/brigid.config.json` unwritable — the
service would start and then fail the moment it tried to persist its config.

> **Using nvm?** systemd starts a non-login shell, so `pnpm` won't be on PATH and
> `command -v pnpm` above will come back empty. Use the absolute interpreter and
> script instead:
> `ExecStart=$HOME/.nvm/versions/node/v22.x.y/bin/node $HOME/brigid/apps/server/node_modules/.bin/tsx $HOME/brigid/apps/server/src/server.ts`

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now brigid
sudo systemctl status brigid --no-pager
```

`enable` is the part that makes it survive reboot; `--now` starts it
immediately. Watch the logs:

```bash
journalctl -u brigid -f
```

### Verify it actually survives a reboot

```bash
sudo reboot
# then, once it's back:
systemctl is-enabled brigid     # enabled
systemctl is-active brigid      # active
curl -s http://127.0.0.1:8090/api/health
```

### Open the port

Only if you reach the box directly rather than through a proxy:

```bash
sudo ufw allow 8090/tcp
```

Brigid has no TLS of its own. For anything beyond a trusted LAN, put Caddy or
nginx in front and proxy to `127.0.0.1:8090`.

### Behind a reverse proxy, at the domain root

```bash
APP_ORIGIN=https://brigid.example.com
SECURE_COOKIES=1
```

`SECURE_COOKIES` is about what the *browser* sees, so set it even though the
proxy reaches Brigid over plain HTTP on localhost. Restart afterwards.

### Behind a reverse proxy, under a subpath

Caddy, serving Brigid at `https://app.example.com/brigid`:

```caddy
redir /brigid /brigid/
handle_path /brigid/* {
  reverse_proxy 127.0.0.1:8090
}
```

`handle_path` strips the prefix before forwarding, so Brigid itself only ever
sees `/`, `/api/…`, and `/assets/…` — it needs no path rewriting. What does need
to know is the browser-facing side, via `.env.local`:

```bash
APP_BASE_PATH=/brigid
APP_ORIGIN=https://app.example.com
SECURE_COOKIES=1
```

That one variable is read twice, for two different reasons:

- **At build time** by the web app, so every emitted asset URL carries the
  prefix. Without it the browser resolves `/assets/index-*.js` against the
  domain root and the page loads blank.
- **At run time** by the server, so the session cookie's `Path` is `/brigid`
  rather than `/`. On a shared hostname the default would send Brigid's cookie
  to every other app there.

Because the build bakes it in, **re-run `pnpm build:web` after changing it** —
`./restart.sh` does that for you.

> Prefer `handle_path /brigid/*` with the `redir` over a bare `handle_path
> /brigid*`: the wildcard form also matches paths like `/brigidsomething`, and
> the redirect is what makes the bare `/brigid` (no trailing slash) work.

---

## 6. Updating

```bash
cd ~/brigid
./restart.sh
```

That stops the service, fast-forwards, reinstalls, migrates, and starts it again.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `{"ok":true,"database":false}` | No `DATABASE_URL` and setup not completed — Brigid is in setup mode. |
| Every route but `/api/setup/*` returns 503 | Same thing: no database attached yet. |
| `{"error":"Brigid is already set up"}` | An account exists. Setup is closed permanently; this is intended. |
| Service dies immediately, `status=203/EXEC` | `ExecStart` path is wrong. Re-check `which pnpm`. |
| Service dies immediately, `status=200/CHDIR` | `WorkingDirectory` doesn't exist or isn't readable by `User`. |
| `password authentication failed for user "brigid"` | Password in `DATABASE_URL` doesn't match the role. Special characters must be percent-encoded. |
| Login succeeds, next request is 401 | `SECURE_COOKIES=1` while serving plain HTTP — the browser is discarding the cookie. |
| `permission denied for schema public` | Postgres 15+ tightened default schema grants. Re-run the `GRANT ALL ON SCHEMA public` from step 3. |
