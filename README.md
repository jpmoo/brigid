# Brigid

A self-hosted novel writing application, named after the Celtic goddess of poetry.

The writer works in a document that looks like the finished book, with an outline
panel beside it exposing the manuscript as a tree of blocks. Single-user by
design: authentication is tailored to one owner, not multi-tenancy.

See [docs/brigid-spec.md](docs/brigid-spec.md) for the design.

## Status

Foundation in place — workspace, domain model, schema, auth, and the first-run
setup flow. No web app yet.

| Piece | State |
|---|---|
| `packages/shared` | Template, variable, and word-count model |
| `packages/db` | Drizzle schema + initial migration, built-in templates seeded |
| `apps/server` | Fastify app, session auth, first-run setup wizard |
| `apps/web` | Not started |

## Stack

- pnpm workspace, TypeScript ESM, Node 22
- Fastify 5, Drizzle ORM over postgres.js, Zod
- Argon2id password hashing, signed cookie sessions
- React + Vite + TipTap (planned)
- Ollama for inference and summarization, configured in Settings

## Running it

Brigid targets a headless Ubuntu server with PostgreSQL 13 or newer. For the
full server setup — deploy key, database, systemd, TLS — see
[docs/deploy.md](docs/deploy.md).

```bash
pnpm install
cp .env.example .env.local   # PORT defaults to 8090
pnpm start
```

With no database configured Brigid starts anyway, in setup mode: first run
establishes the database, migrates, and creates the single account. Until the
web app exists that step is a `curl` call — see step 5 of the deploy guide.

To configure by hand instead, set `DATABASE_URL` and `SESSION_SECRET` in
`.env.local`; migrations then run automatically at boot.
