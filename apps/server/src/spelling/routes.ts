import { asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { dictionaryWords, settings } from "@brigid/db";
import { foldApostrophes } from "@brigid/shared";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";

/**
 * The Hunspell dictionary, read once and held.
 *
 * Half a megabyte, and the browser is what actually runs the checker — a word
 * is judged as it is typed, and a round trip per word would be absurd. So the
 * server's whole job here is to hand the files over. Reading them from the
 * installed package rather than committing a copy means the dictionary updates
 * with a dependency bump like anything else.
 */
let dictionary: { aff: string; dic: string } | null = null;

async function loadDictionary(): Promise<{ aff: string; dic: string }> {
  if (dictionary) return dictionary;
  // Through the package's own entry point, not by reaching for the .aff and
  // .dic beside it: dictionary-en declares a single export and Node refuses
  // every other subpath, so resolving the files directly throws. Imported
  // dynamically because the module reads them with a top-level await, which
  // there is no reason to pay for when checking is switched off.
  const { default: files } = await import("dictionary-en");
  dictionary = {
    aff: Buffer.from(files.aff).toString("utf8"),
    dic: Buffer.from(files.dic).toString("utf8"),
  };
  return dictionary;
}

/**
 * The uniqueness key: case, and the shape of the apostrophe.
 *
 * "Maren" should settle "maren", and "Brandan’s" should settle "Brandan's" —
 * the manuscript holds the typeset apostrophe and a keyboard produces the
 * straight one, and nobody wants to teach the same word twice for that.
 */
const fold = (word: string) => foldApostrophes(word).toLocaleLowerCase("en");

/** One word: no spaces, and nothing that isn't part of a word. */
const wordSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((w) => !/\s/.test(w), "a dictionary entry is a single word");

export async function spellingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /**
   * Served separately from the settings so the client can decide whether it
   * wants half a megabyte before asking for it. Immutable: the contents only
   * change when the package does, and then the deployment is new anyway.
   */
  app.get("/spelling/dictionary", async (req, reply) => {
    requireUser(req);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return loadDictionary();
  });

  app.get("/spelling", async (req) => {
    requireUser(req);
    const [row] = await db
      .select({ enabled: settings.spellcheckEnabled })
      .from(settings)
      .limit(1);
    const words = await db
      .select()
      .from(dictionaryWords)
      .orderBy(asc(dictionaryWords.wordFolded));
    return { enabled: row?.enabled ?? true, words };
  });

  app.patch("/spelling", async (req) => {
    requireUser(req);
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    const [row] = await db
      .update(settings)
      .set({ spellcheckEnabled: body.enabled, updatedAt: new Date() })
      .returning({ enabled: settings.spellcheckEnabled });
    return { enabled: row?.enabled ?? body.enabled };
  });

  app.post("/spelling/words", async (req, reply) => {
    requireUser(req);
    const body = z.object({ word: wordSchema }).parse(req.body);

    // Adding a word already known is what happens when the same name is taught
    // from two places in the manuscript. It isn't an error; it's a no-op that
    // should hand back the row that already covers it.
    const [row] = await db
      .insert(dictionaryWords)
      .values({ word: body.word, wordFolded: fold(body.word) })
      .onConflictDoUpdate({
        target: dictionaryWords.wordFolded,
        set: { word: sql`${dictionaryWords.word}` },
      })
      .returning();
    if (!row) throw badRequest("could not add that word");
    reply.status(201);
    return { word: row };
  });

  app.delete("/spelling/words/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [row] = await db
      .delete(dictionaryWords)
      .where(eq(dictionaryWords.id, id))
      .returning({ id: dictionaryWords.id });
    if (!row) throw notFound("word");
    return { ok: true };
  });
}
