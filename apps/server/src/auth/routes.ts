import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users } from "@brigid/db";
import { env } from "../config.js";
import { db } from "../db.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { authenticate, requireUser } from "./middleware.js";
import { assertPasswordAcceptable, hashPassword, verifyPassword } from "./password.js";
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  sessionCookieOptions,
} from "./session.js";

const credentials = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(1024),
});

/**
 * A real Argon2 hash of a value nobody knows, computed once and reused as the
 * comparison target when the username doesn't exist.
 */
let decoy: Promise<string> | null = null;
function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(32).toString("base64"));
  return decoy;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/auth/login", async (req, reply) => {
    const body = credentials.parse(req.body);

    const [user] = await db
      .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.username, body.username))
      .limit(1);

    // Verify even when the user is missing, so a wrong username and a wrong
    // password cost the same and can't be told apart by timing. The decoy must
    // be a real hash — a malformed one fails to parse immediately and would
    // reintroduce exactly the timing difference this is here to remove.
    const ok = await verifyPassword(user?.passwordHash ?? (await decoyHash()), body.password);
    if (!user || !ok) throw unauthorized("incorrect username or password");

    const { token } = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(env.secureCookies, env.basePath));
    return { username: user.username };
  });

  app.post("/auth/logout", async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = req.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) await destroySession(unsigned.value);
    }
    reply.clearCookie(SESSION_COOKIE, { path: env.basePath });
    return { ok: true };
  });

  app.get("/auth/me", async (req) => {
    const userId = requireUser(req);
    const [user] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return { username: user?.username ?? null };
  });

  app.post("/auth/password", async (req) => {
    const userId = requireUser(req);
    const body = z
      .object({
        currentPassword: z.string().min(1).max(1024),
        newPassword: z.string().min(1).max(1024),
      })
      .parse(req.body);

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw unauthorized();
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw unauthorized("current password is incorrect");
    }

    const problem = assertPasswordAcceptable(body.newPassword);
    if (problem) throw badRequest(problem);

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: new Date() })
      .where(eq(users.id, userId));
    return { ok: true };
  });
}
