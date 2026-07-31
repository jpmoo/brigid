import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthorized } from "../lib/errors.js";
import { SESSION_COOKIE, resolveSession } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}

/**
 * preHandler hook. Resolves the signed session cookie onto the request. Does not
 * reject on its own — routes call `requireUser` — so a route can be registered
 * under the hook and still serve anonymous callers if it wants to.
 */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return;
  const unsigned = req.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return;
  const userId = await resolveSession(unsigned.value);
  if (userId) req.userId = userId;
}

export function requireUser(req: FastifyRequest): string {
  if (!req.userId) throw unauthorized();
  return req.userId;
}
