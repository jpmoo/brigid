import { settings } from "@brigid/db";
import { db } from "../db.js";
import { badRequest } from "../lib/errors.js";
import type { Provider } from "./detect.js";

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
  /** Null on settings saved before there was more than one kind of server. */
  provider: Provider;
  apiKey: string | null;
}

/** Null when nothing is connected, for anything that can carry on without one. */
export async function reader(): Promise<Reader | null> {
  const [row] = await db
    .select({
      url: settings.ollamaUrl,
      model: settings.inferenceModel,
      numCtx: settings.ollamaNumCtx,
      thinks: settings.ollamaThinks,
      provider: settings.aiProvider,
      apiKey: settings.aiApiKey,
    })
    .from(settings)
    .limit(1);
  if (!row?.url || !row.model) return null;
  return {
    url: row.url,
    model: row.model,
    numCtx: row.numCtx,
    thinks: row.thinks,
    // Ollama is what a row without one meant: at the time it was written there
    // was nothing else this could have been talking to.
    provider: row.provider ?? "ollama",
    apiKey: row.apiKey,
  };
}

/** For a request that was explicitly asking the model to do something. */
export async function readerOrFail(): Promise<Reader> {
  const found = await reader();
  if (!found) throw badRequest("no model is connected");
  return found;
}
