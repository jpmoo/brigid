import { isNull } from "drizzle-orm";
import { settings } from "@brigid/db";
import { db } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { detect } from "./detect.js";
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

/**
 * Work out what a connection speaks, when nothing recorded it, and remember.
 *
 * A connection saved before this application could talk to anything but Ollama
 * has no protocol stored, and null had to mean something — it meant Ollama,
 * because at the time there was nothing else it could have been. That is a fair
 * reading of the history and a bad thing to act on: point an old row at an
 * OpenAI-compatible server and every request goes to /api/generate and comes
 * back 404, for ever, with a settings screen that looks entirely correct.
 *
 * So it is detected once and written down, rather than the writer being asked
 * to re-save a setting to repair something they were never told was wrong. The
 * walk in `worker.ts` fills in a missing context window the same way and for
 * the same reason.
 *
 * Ollama remains the answer when nothing answers at all. Something has to be
 * assumed to report a useful error, and the error it produces names the address
 * and says what was assumed.
 */
async function settleProvider(url: string, stored: Provider | null): Promise<Provider> {
  if (stored) return stored;

  const found = await detect(url).catch(() => null);
  if (!found) return "ollama";

  await db
    .update(settings)
    .set({ aiProvider: found.provider })
    .where(isNull(settings.aiProvider));
  return found.provider;
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
    provider: await settleProvider(row.url, row.provider),
    apiKey: row.apiKey,
  };
}

/** For a request that was explicitly asking the model to do something. */
export async function readerOrFail(): Promise<Reader> {
  const found = await reader();
  if (!found) throw badRequest("no model is connected");
  return found;
}
