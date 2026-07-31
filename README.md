# Brigid

A self-hosted novel writing application, named after the Celtic goddess of poetry.

The writer works in a document that looks like the finished book, with an outline
panel beside it exposing the manuscript as a tree of blocks. Single-user by
design: authentication is tailored to one owner, not multi-tenancy.

See [docs/brigid-spec.md](docs/brigid-spec.md) for the design.

## Status

You can set up an instance, sign in, and manage a library of works. The editor
— the outline panel and the stitched document view — is next.

| Piece | State |
|---|---|
| `packages/shared` | Template, variable, and word-count model |
| `packages/db` | Drizzle schema + initial migration, built-in templates seeded |
| `apps/server` | Fastify app, session auth, first-run setup, works API |
| `apps/web` | Setup wizard, login, library |

## Stack

- pnpm workspace, TypeScript ESM, Node 22
- Fastify 5, Drizzle ORM over postgres.js, Zod
- Argon2id password hashing, signed cookie sessions
- React + Vite + TipTap (planned)
- Ollama for inference and summarization, configured in Settings

## Running it

Brigid targets a headless Ubuntu server with PostgreSQL 13 or newer. For the
full server setup — clone, database, systemd, TLS — see
[docs/deploy.md](docs/deploy.md).

```bash
pnpm install
pnpm build:web
cp .env.example .env.local   # PORT defaults to 8090
pnpm start
```

With no database configured Brigid starts anyway, in setup mode: opening it in a
browser gives you a setup screen that establishes the database, migrates, creates
the single account, and signs you in.

To configure by hand instead, set `DATABASE_URL` and `SESSION_SECRET` in
`.env.local`; migrations then run automatically at boot.

For development, run the API and Vite separately — Vite proxies `/api` to 8090,
so the session cookie behaves exactly as in production:

```bash
pnpm dev:server   # and, in another shell, pnpm dev:web
```
