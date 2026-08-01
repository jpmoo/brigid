import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { settings } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { contextLengthOf } from "./client.js";
import { placedDigests, progressOf } from "./worker.js";

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

/** The saved connection, in the one shape every route here returns. */
async function current() {
  const [row] = await db
    .select({
      url: settings.ollamaUrl,
      analysisModel: settings.inferenceModel,
      numCtx: settings.ollamaNumCtx,
    })
    .from(settings)
    .limit(1);
  return {
    url: row?.url ?? null,
    analysisModel: row?.analysisModel ?? null,
    numCtx: row?.numCtx ?? null,
  };
}

export async function ollamaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/ollama", async (req) => {
    requireUser(req);
    return current();
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

  /**
   * How far the walk has got, for one manuscript.
   *
   * Polled while the panel is open, so it stays cheap: counts and an estimate,
   * not the digest itself.
   */
  app.get("/works/:workId/digest/progress", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    return progressOf(workId);
  });

  /**
   * Everything the walk has collected, section by section.
   *
   * The analysis is only as good as this, so it is not hidden behind the
   * findings — a spider graph nobody can check is a spider graph nobody should
   * believe. Positions are computed here rather than stored, since they shift
   * whenever any section changes length.
   */
  app.get("/works/:workId/digest", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    return {
      progress: await progressOf(workId),
      sections: await placedDigests(workId),
    };
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

    /**
     * The window is settled here, when the model is chosen, rather than left to
     * whatever Ollama would otherwise serve — which is a couple of thousand
     * tokens no matter what the model can hold, and which truncates silently.
     * A reader of long prose given a small window doesn't fail; it answers
     * confidently about the first fifth of the chapter.
     */
    const target =
      (patch.ollamaUrl as string | null | undefined) ??
      (await db.select({ url: settings.ollamaUrl }).from(settings).limit(1))[0]?.url ??
      null;
    const model = (patch.inferenceModel as string | null | undefined) ?? null;
    if (model && target) {
      patch.ollamaNumCtx = await contextLengthOf(target, model).catch(() => null);
    } else if (body.analysisModel === null || body.url === null) {
      patch.ollamaNumCtx = null;
    }

    await db.update(settings).set(patch).where(eq(settings.id, row.id));
    return current();
  });
}
