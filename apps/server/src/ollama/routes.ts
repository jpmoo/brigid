import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { settings } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest } from "../lib/errors.js";

/**
 * Where Ollama is, and which model to think with.
 *
 * The server asks Ollama rather than the browser, because Ollama is usually on
 * the same machine as Brigid and not reachable from wherever the writing is
 * being done — and because a model's answer is going to be stored here anyway.
 */

/**
 * The address is asked for rather than assumed, so it has to be checked.
 *
 * Only http and https, and only a host — no file:, no unix sockets, nothing
 * with credentials in it. The one writer of this value is the instance's owner,
 * who could point a browser anywhere themselves; the check is here so a saved
 * setting can't quietly become a stranger request the server makes on a timer.
 */
export function asOllamaUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw badRequest("that doesn't look like a URL — try http://localhost:11434");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest("the address has to be http or https");
  }
  if (url.username || url.password) throw badRequest("leave credentials out of the address");
  // Trailing slashes make every join below a guessing game.
  return `${url.protocol}//${url.host}`;
}

/** What Ollama says it has. Names only — the rest is its own bookkeeping. */
export async function modelsAt(url: string): Promise<string[]> {
  const answer = await fetch(`${url}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => {
    throw badRequest(`nothing answered at ${url}`);
  });

  if (!answer.ok) throw badRequest(`${url} answered ${answer.status} — is that Ollama?`);

  const body = (await answer.json().catch(() => null)) as { models?: unknown } | null;
  if (!body || !Array.isArray(body.models)) {
    throw badRequest(`${url} answered, but not like Ollama would`);
  }

  return body.models
    .map((m) => (m as { name?: unknown }).name)
    .filter((name): name is string => typeof name === "string")
    .sort((a, b) => a.localeCompare(b));
}

export async function ollamaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/ollama", async (req) => {
    requireUser(req);
    const [row] = await db
      .select({ url: settings.ollamaUrl, analysisModel: settings.inferenceModel })
      .from(settings)
      .limit(1);
    return { url: row?.url ?? null, analysisModel: row?.analysisModel ?? null };
  });

  /**
   * What is installed over there.
   *
   * Takes an address so the list can be fetched before anything is saved —
   * connecting and choosing a model is one action, and it would be a poor one
   * that made you save a URL you hadn't yet confirmed answers.
   */
  app.get("/ollama/models", async (req) => {
    requireUser(req);
    const { url } = z.object({ url: z.string().optional() }).parse(req.query ?? {});

    let target = url ? asOllamaUrl(url) : null;
    if (!target) {
      const [row] = await db.select({ url: settings.ollamaUrl }).from(settings).limit(1);
      if (!row?.url) throw badRequest("no address set yet");
      target = row.url;
    }

    return { url: target, models: await modelsAt(target) };
  });

  app.patch("/ollama", async (req) => {
    requireUser(req);
    const body = z
      .object({
        url: z.string().nullable().optional(),
        analysisModel: z.string().max(200).nullable().optional(),
      })
      .parse(req.body);

    const [row] = await db.select({ id: settings.id }).from(settings).limit(1);
    if (!row) throw badRequest("settings are not ready");

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    // Null clears the connection; anything else has to be an address.
    if (body.url !== undefined) patch.ollamaUrl = body.url === null ? null : asOllamaUrl(body.url);
    if (body.analysisModel !== undefined) patch.inferenceModel = body.analysisModel;

    await db.update(settings).set(patch).where(eq(settings.id, row.id));

    const [saved] = await db
      .select({ url: settings.ollamaUrl, analysisModel: settings.inferenceModel })
      .from(settings)
      .limit(1);
    return { url: saved?.url ?? null, analysisModel: saved?.analysisModel ?? null };
  });
}
