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

Brigid targets a headless Ubuntu server with PostgreSQL 13 or newer.

```bash
pnpm install
cp .env.example .env.local   # set PORT, HOST, APP_ORIGIN
pnpm dev:server
```

Then open the app. With no database configured, the first screen is a setup
wizard that provisions PostgreSQL (or accepts an existing connection string),
runs migrations, and creates your account. Nothing else needs to be configured
by hand.

To skip the wizard, set `DATABASE_URL` and `SESSION_SECRET` in `.env.local` and
run `pnpm db:migrate`.
