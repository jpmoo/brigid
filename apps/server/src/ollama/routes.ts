import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { digestState, sectionDigests, settings } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { inspectModel } from "./client.js";
import { detect } from "./detect.js";
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


/** The saved connection, in the one shape every route here returns. */
async function current() {
  const [row] = await db
    .select({
      url: settings.ollamaUrl,
      analysisModel: settings.inferenceModel,
      numCtx: settings.ollamaNumCtx,
      thinks: settings.ollamaThinks,
      provider: settings.aiProvider,
      apiKey: settings.aiApiKey,
    })
    .from(settings)
    .limit(1);
  return {
    url: row?.url ?? null,
    analysisModel: row?.analysisModel ?? null,
    numCtx: row?.numCtx ?? null,
    thinks: row?.thinks ?? null,
    // Null until an address has been probed. Ollama on rows written before
    // there was anything else to be.
    provider: row?.url ? (row.provider ?? "ollama") : null,
    /** Whether one is set, never what it is. */
    hasApiKey: Boolean(row?.apiKey),
  };
}

export async function ollamaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/ai", async (req) => {
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
  app.get("/ai/detect", async (req) => {
    requireUser(req);
    const { url } = z.object({ url: z.string().optional() }).parse(req.query ?? {});

    let target = url ? asOllamaUrl(url) : null;
    if (!target) {
      const [row] = await db.select({ url: settings.ollamaUrl }).from(settings).limit(1);
      if (!row?.url) throw badRequest("no address set yet");
      target = row.url;
    }

    const found = await detect(target);
    if (!found) {
      throw badRequest(
        "nothing answered there — check the address and that the server is running",
      );
    }
    return { url: target, ...found };
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

  /**
   * Call the reading off, or set it going again.
   *
   * Stopping keeps every section already read. Starting over throws them away
   * first, which is what makes it the right answer after a prompt or model
   * change — half a book read one way and half the other is not a reading
   * anyone should judge a manuscript from.
   */
  app.post("/works/:workId/digest/:action", async (req) => {
    requireUser(req);
    const { workId, action } = z
      .object({
        workId: z.string().uuid(),
        action: z.enum(["stop", "resume", "restart"]),
      })
      .parse(req.params);

    if (action === "restart") {
      await db.transaction(async (tx) => {
        await tx.delete(sectionDigests).where(eq(sectionDigests.workId, workId));
        await tx
          .insert(digestState)
          .values({ workId, status: "idle", lastError: null, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: digestState.workId,
            set: { status: "idle", lastError: null, startedAt: null, finishedAt: null, updatedAt: new Date() },
          });
      });
      return { progress: await progressOf(workId) };
    }

    const status = action === "stop" ? ("stopped" as const) : ("idle" as const);
    await db
      .insert(digestState)
      .values({ workId, status, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: digestState.workId,
        set: { status, lastError: null, updatedAt: new Date() },
      });

    return { progress: await progressOf(workId) };
  });

  app.patch("/ai", async (req) => {
    requireUser(req);
    const body = z
      .object({
        url: z.string().nullable().optional(),
        analysisModel: z.string().max(200).nullable().optional(),
        // Null clears it; absent leaves whatever is there alone, so saving a
        // model does not wipe a key the screen was never shown.
        apiKey: z.string().max(400).nullable().optional(),
      })
      .parse(req.body);

    const [row] = await db.select({ id: settings.id }).from(settings).limit(1);
    if (!row) throw badRequest("settings are not ready");

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    // Null clears the connection; anything else has to be an address.
    if (body.url !== undefined) patch.ollamaUrl = body.url === null ? null : asOllamaUrl(body.url);
    if (body.analysisModel !== undefined) patch.inferenceModel = body.analysisModel;
    if (body.apiKey !== undefined) patch.aiApiKey = body.apiKey?.trim() || null;

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

    /**
     * What is answering there, settled here rather than asked of the writer.
     *
     * Also where the window comes from. Ollama serves a couple of thousand
     * tokens by default however much the model can hold, and a reader of long
     * prose given a small window does not fail — it answers confidently about
     * the first fifth of the chapter. So the model is inspected and the real
     * figure stored. Nothing else exposes one per model: llama.cpp says what it
     * loaded with, and the rest say nothing, in which case none is sent and the
     * server's own configuration governs.
     */
    if (target && body.url !== null) {
      const found = await detect(target);
      if (found) {
        patch.aiProvider = found.provider;
        if (found.provider === "ollama" && model) {
          const seen = await inspectModel(target, model).catch(() => ({
            numCtx: null,
            thinks: null,
          }));
          patch.ollamaNumCtx = seen.numCtx;
          patch.ollamaThinks = seen.thinks;
        } else {
          patch.ollamaNumCtx = found.numCtx;
          patch.ollamaThinks = null;
          // Whatever it is serving, when it serves exactly one and the writer
          // was given nothing to choose.
          if (!model && found.models.length > 0) patch.inferenceModel = found.models[0];
        }
      }
    }

    if (body.analysisModel === null || body.url === null) {
      patch.ollamaNumCtx = null;
      patch.ollamaThinks = null;
      if (body.url === null) {
        patch.aiProvider = null;
        patch.aiApiKey = null;
      }
    }

    await db.update(settings).set(patch).where(eq(settings.id, row.id));
    return current();
  });
}
