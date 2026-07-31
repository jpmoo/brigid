# Deploying Brigid on Ubuntu

Target: a headless Ubuntu server, PostgreSQL 13+, Brigid on **port 8090**,
surviving reboots via systemd.

> **Current limitation.** There is no web UI yet — only the API. First-run setup
> is therefore driven with `curl` (step 5). Once the web app lands, that step
> becomes a form in the browser and nothing else here changes.

Substitute your own values for `/opt/brigid` (the checkout) and `jpmoore` (the
account that owns it) throughout.

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
> find it. If you're already committed to nvm, see the note in step 6.

Confirm:

```bash
node -v && pnpm -v && psql --version
```

---

## 2. Give the server access to the private repo

A read-only deploy key is the right fit: scoped to this one repo, no account
password on the box, and it survives unattended `git pull`.

```bash
ssh-keygen -t ed25519 -C "brigid-deploy" -f ~/.ssh/brigid_deploy -N ""
cat ~/.ssh/brigid_deploy.pub
```

Add that public key at **github.com/jpmoo/brigid → Settings → Deploy keys → Add
deploy key**. Leave "Allow write access" unchecked.

Then teach SSH which key to use:

```bash
cat >> ~/.ssh/config <<'EOF'

Host github.com-brigid
  HostName github.com
  User git
  IdentityFile ~/.ssh/brigid_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
```

Verify — a "successfully authenticated" message is what you want, and the
message saying GitHub does not provide shell access is expected:

```bash
ssh -T git@github.com-brigid
```

---

## 3. Clone into the existing directory

`git clone` refuses to write into a directory that already has files in it, so
which command you want depends on what's already there.

**If the directory is empty** — clone into `.`:

```bash
cd /opt/brigid
git clone git@github.com-brigid:jpmoo/brigid.git .
```

**If the directory already has files** you want to keep — attach a repo to it
instead of cloning:

```bash
cd /opt/brigid
git init -b main
git remote add origin git@github.com-brigid:jpmoo/brigid.git
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

Make sure you own the checkout, then install:

```bash
sudo chown -R jpmoore:jpmoore /opt/brigid
cd /opt/brigid
pnpm install
```

---

## 4. Configure

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

---

## 5. First start and account creation

```bash
cd /opt/brigid
pnpm start
```

Migrations run automatically at boot when `DATABASE_URL` is set. In another
shell, confirm it's up and still expecting setup:

```bash
curl -s http://127.0.0.1:8090/api/health
curl -s http://127.0.0.1:8090/api/setup/status
```

You want `{"ok":true,"database":true}` and `{"needsSetup":true}`.

Create the single account — password must be at least 10 characters:

```bash
curl -sS -X POST http://127.0.0.1:8090/api/setup/complete \
  -H 'content-type: application/json' \
  -d '{
        "database": {
          "mode": "existing",
          "url": "postgres://brigid:pick-a-strong-password@localhost:5432/brigid"
        },
        "account": { "username": "jpmoo", "password": "your-password-here" }
      }'
```

Check that setup has closed behind you:

```bash
curl -s http://127.0.0.1:8090/api/setup/status   # {"needsSetup":false}
```

That endpoint refuses every further call now that an account exists. Stop the
foreground server with Ctrl-C before moving on.

---

## 6. systemd

```bash
sudo cp deploy/brigid.service /etc/systemd/system/brigid.service
which pnpm          # note the path — usually /usr/bin/pnpm
sudo nano /etc/systemd/system/brigid.service
```

Set four things to match your box: `User`, `WorkingDirectory`, `ExecStart` (the
`which pnpm` path), and `ReadWritePaths`.

> **Using nvm anyway?** systemd starts a non-login shell, so `pnpm` won't be on
> PATH. Point `ExecStart` at the absolute interpreter and script instead:
> `ExecStart=/home/jpmoore/.nvm/versions/node/v22.x.y/bin/node /opt/brigid/apps/server/node_modules/.bin/tsx /opt/brigid/apps/server/src/server.ts`

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

Brigid has no TLS of its own. For anything beyond a trusted LAN, put nginx or
Caddy in front on 443, proxy to `127.0.0.1:8090`, then set `SECURE_COOKIES=1`
and the `https://` form of `APP_ORIGIN` in `.env.local` and restart.

---

## 7. Updating

```bash
cd /opt/brigid
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
| `permission denied for schema public` | Postgres 15+ tightened default schema grants. Re-run the `GRANT ALL ON SCHEMA public` from step 4. |
