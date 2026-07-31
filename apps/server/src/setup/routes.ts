import { runMigrations } from "@brigid/db";
import { users } from "@brigid/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, persistDatabaseUrl } from "../config.js";
import { db, initDb, isDbReady } from "../db.js";
import { assertPasswordAcceptable, hashPassword } from "../auth/password.js";
import { SESSION_COOKIE, createSession, sessionCookieOptions } from "../auth/session.js";
import { badRequest, conflict } from "../lib/errors.js";
import { provisionDatabase, testConnection } from "./pg-admin.js";

const existingDatabase = z.object({
  mode: z.literal("existing"),
  url: z.string().min(1).max(2000),
});

const provisionedDatabase = z.object({
  mode: z.literal("provision"),
  admin: z.object({
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    user: z.string().min(1).max(63),
    password: z.string().max(1024),
    database: z.string().min(1).max(63).default("postgres"),
    ssl: z.boolean().optional(),
  }),
  app: z.object({
    dbName: z.string().min(1).max(63),
    user: z.string().min(1).max(63),
    password: z.string().min(1).max(1024),
  }),
});

const setupBody = z.object({
  database: z.discriminatedUnion("mode", [existingDatabase, provisionedDatabase]),
  account: z.object({
    username: z.string().min(1).max(200),
    password: z.string().min(1).max(1024),
  }),
});

/**
 * Whether setup is still open. It closes the moment an account exists, which is
 * the important part: these routes are unauthenticated by necessity — there is
 * nobody to authenticate as yet — so leaving them reachable afterwards would let
 * anyone repoint the instance at their own database.
 */
async function setupIsOpen(): Promise<boolean> {
  if (!isDbReady()) return true;
  try {
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    return existing.length === 0;
  } catch {
    // Configured but unmigrated or unreachable — still finishable.
    return true;
  }
}

export async function setupRoutes(app: FastifyInstance): Promise<void> {
  app.get("/setup/status", async () => ({ needsSetup: await setupIsOpen() }));

  app.post("/setup/test-connection", async (req) => {
    if (!(await setupIsOpen())) throw conflict("Brigid is already set up");
    const body = z.object({ url: z.string().min(1).max(2000) }).parse(req.body);
    await testConnection(body.url);
    return { ok: true };
  });

  /**
   * The whole first run in one call: establish the database, persist the config,
   * migrate, create the single account, and sign the writer in. Doing it as one
   * step means a failure part-way leaves nothing half-configured to reason
   * about — the caller just fixes the input and posts again.
   */
  app.post("/setup/complete", async (req, reply) => {
    if (!(await setupIsOpen())) throw conflict("Brigid is already set up");
    const body = setupBody.parse(req.body);

    const problem = assertPasswordAcceptable(body.account.password);
    if (problem) throw badRequest(problem);

    let databaseUrl: string;
    if (body.database.mode === "existing") {
      await testConnection(body.database.url);
      databaseUrl = body.database.url;
    } else {
      const { admin, app: appDb } = body.database;
      databaseUrl = await provisionDatabase(
        {
          host: admin.host,
          port: admin.port,
          user: admin.user,
          password: admin.password,
          database: admin.database,
          ...(admin.ssl === undefined ? {} : { ssl: admin.ssl }),
        },
        {
          host: admin.host,
          port: admin.port,
          dbName: appDb.dbName,
          user: appDb.user,
          password: appDb.password,
        },
      );
    }

    await runMigrations(databaseUrl);
    await persistDatabaseUrl(databaseUrl);
    initDb(databaseUrl);

    // Re-check now that the real database is attached: a pointed-at database
    // that already holds an account is somebody else's Brigid.
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) throw conflict("that database already has a Brigid account");

    const [created] = await db
      .insert(users)
      .values({
        username: body.account.username,
        passwordHash: await hashPassword(body.account.password),
      })
      .returning({ id: users.id, username: users.username });
    if (!created) throw badRequest("could not create the account");

    // The signing secret was minted at boot, so this cookie is valid
    // immediately — no restart, straight into the library.
    const { token } = await createSession(created.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(env.secureCookies, env.basePath));

    return { ok: true, username: created.username };
  });
}
