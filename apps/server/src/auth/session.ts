import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { sessions } from "@brigid/db";
import { db } from "../db.js";

export const SESSION_COOKIE = "brigid_session";
const SESSION_DAYS = 30;

/**
 * Only the hash is stored, so a database dump doesn't hand over live sessions.
 * The token is high-entropy random, so a plain digest is enough — there is no
 * low-entropy guess space to grind.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

/** Returns the owning user id, or null if unknown or expired. */
export async function resolveSession(token: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await destroySession(token);
    return null;
  }
  return row.userId;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function purgeExpiredSessions(): Promise<number> {
  const removed = await db.delete(sessions).where(lt(sessions.expiresAt, new Date())).returning({
    tokenHash: sessions.tokenHash,
  });
  return removed.length;
}

export const sessionCookieOptions = (secure: boolean) =>
  ({
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    signed: true,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  }) as const;
