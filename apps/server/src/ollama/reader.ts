import { settings } from "@brigid/db";
import { db } from "../db.js";
import { badRequest } from "../lib/errors.js";

/**
 * Which model is answering, and how much it can hold.
 *
 * There were three copies of this and a fourth was about to be written. The
 * walk in `worker.ts` keeps its own, because it does something more — it fills
 * in a context window that was never detected, which is worth doing exactly
 * once at the start of a long read and not on every request.
 */
export interface Reader {
  url: string;
  model: string;
  numCtx: number | null;
  thinks: boolean | null;
}

/** Null when nothing is connected, for anything that can carry on without one. */
export async function reader(): Promise<Reader | null> {
  const [row] = await db
    .select({
      url: settings.ollamaUrl,
      model: settings.inferenceModel,
      numCtx: settings.ollamaNumCtx,
      thinks: settings.ollamaThinks,
    })
    .from(settings)
    .limit(1);
  if (!row?.url || !row.model) return null;
  return { url: row.url, model: row.model, numCtx: row.numCtx, thinks: row.thinks };
}

/** For a request that was explicitly asking the model to do something. */
export async function readerOrFail(): Promise<Reader> {
  const found = await reader();
  if (!found) throw badRequest("no model is connected");
  return found;
}
