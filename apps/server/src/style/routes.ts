import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { blocks, styleProfiles, works } from "@brigid/db";
import {
  baselines,
  deviations,
  featureLabel,
  leastCharacteristic,
  mostCharacteristic,
  RELIABLE_WORDS,
  THIN_CORPUS_WORDS,
} from "@brigid/shared";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { notFound } from "../lib/errors.js";
import { refresh } from "./measure.js";
import { describe } from "./describe.js";

/**
 * ProseDNA over the wire.
 *
 * Everything relative is computed here, on every read, from raw measurements —
 * so excluding a chapter is a single boolean write and the next read simply
 * comes back different. Nothing is invalidated because nothing derived was
 * stored to invalidate.
 */

export async function styleRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  async function workOr404(workId: string) {
    const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
    if (!work) throw notFound("work");
    return work;
  }

  /**
   * The whole picture: what was measured, what the normal is, and how far each
   * section sits from it.
   */
  app.get("/works/:workId/style", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await workOr404(workId);

    const samples = await refresh(workId);

    // Named here rather than in the measurement: a label is a fact about the
    // outline, and threading it through the arithmetic would tie the two
    // together for no reason beyond saving a query.
    const named = new Map(
      (
        await db
          .select({ id: blocks.id, label: blocks.label })
          .from(blocks)
          .where(eq(blocks.workId, workId))
      ).map((b) => [b.id, b.label]),
    );
    const built = baselines(samples);
    const found = deviations(samples, built);
    const book = built.get(null);

    const [profile] = await db
      .select()
      .from(styleProfiles)
      .where(eq(styleProfiles.workId, workId))
      .limit(1);

    const corpusWords = book?.words ?? 0;

    return {
      corpus: {
        sections: book?.sections ?? 0,
        words: corpusWords,
        // Reported rather than enforced: a writer part-way through a draft
        // should see what has been measured, told plainly it will move.
        thin: corpusWords < THIN_CORPUS_WORDS,
        thinBelow: THIN_CORPUS_WORDS,
        reliableAbove: RELIABLE_WORDS,
        voices: [...built.keys()].filter((v): v is string => v !== null),
      },
      sections: samples.map((s) => {
        const d = found.find((f) => f.blockId === s.blockId);
        return {
          blockId: s.blockId,
          label: named.get(s.blockId) ?? "",
          words: s.measurement.words,
          dialogueShare: s.measurement.dialogueShare,
          included: s.included,
          voice: s.voice,
          delta: d?.delta ?? 0,
          reliable: d?.reliable ?? false,
          against: d?.against ?? null,
          byStream: d?.byStream ?? { overall: 0, narration: 0, dialogue: 0 },
          moved:
            d?.moved.map((m) => ({
              key: m.key,
              label: labelOf(m.key),
              z: m.z,
              value: m.value,
              mean: m.mean,
            })) ?? [],
        };
      }),
      /** The strands of the graph: one figure per family, book-wide. */
      strands: book ? strandsOf(book.overall) : [],
      typical: mostCharacteristic(found, samples),
      atypical: leastCharacteristic(found, samples).map((d) => d.blockId),
      profile: profile
        ? {
            card: profile.card,
            cardEdited: profile.cardEdited,
            exemplars: profile.exemplars,
            commentary: profile.commentary,
            model: profile.model,
            generatedAt: profile.generatedAt,
            stale: profile.corpusSignature !== signature(samples),
          }
        : null,
    };
  });

  /** Which sections count, and which voice they are written in. */
  app.patch("/works/:workId/style/sections", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        blockIds: z.array(z.string().uuid()).min(1).max(2000),
        included: z.boolean().optional(),
        // Null clears the tag and returns the section to the book's own voice.
        voice: z.string().min(1).max(60).nullable().optional(),
      })
      .parse(req.body);
    await workOr404(workId);

    const patch: Record<string, unknown> = {};
    if (body.included !== undefined) patch["styleExcluded"] = !body.included;
    if (body.voice !== undefined) patch["styleVoice"] = body.voice;
    if (Object.keys(patch).length === 0) return { ok: true as const, changed: 0 };

    // Only blocks of this manuscript, checked rather than trusted.
    const updated = await db
      .update(blocks)
      .set(patch)
      .where(and(eq(blocks.workId, workId), inArray(blocks.id, body.blockIds)))
      .returning({ id: blocks.id });

    return { ok: true as const, changed: updated.length };
  });

  /**
   * Ask the model to read the numbers.
   *
   * Everything above works without one. This is the part that turns two hundred
   * rates into something a person can act on, and it is the only part that
   * needs Ollama connected.
   */
  app.post("/works/:workId/style/describe", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { force } = z.object({ force: z.boolean().optional() }).parse(req.body ?? {});
    await workOr404(workId);
    return describe(workId, { force: force ?? false });
  });

  /** The writer's own words about their voice, which outrank the model's. */
  app.patch("/works/:workId/style/card", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { card } = z.object({ card: z.string().max(20000) }).parse(req.body);
    await workOr404(workId);

    await db
      .insert(styleProfiles)
      .values({ workId, card, cardEdited: true })
      .onConflictDoUpdate({
        target: styleProfiles.workId,
        set: { card, cardEdited: true },
      });

    return { ok: true as const };
  });
}

/** A feature key as a reader should see it, stream and all. */
function labelOf(key: string): string {
  const [stream, rest] = key.includes(":") ? key.split(":") : [null, key];
  const label = featureLabel(rest!);
  if (!stream) return label;
  return stream === "dialogue" ? `${label}, in dialogue` : `${label}, in narration`;
}

/**
 * What the corpus looked like when something was written about it.
 *
 * Section ids and their lengths, so adding a chapter or excluding one changes
 * the signature and the card is marked as describing a different book. Not a
 * hash of the prose: rewording a sentence does not make a description of a
 * voice out of date.
 */
export function signature(samples: { blockId: string; included: boolean; measurement: { words: number } }[]): string {
  return samples
    .filter((s) => s.included)
    .map((s) => `${s.blockId}:${s.measurement.words}`)
    .sort()
    .join("|");
}

/**
 * The strands of the graph.
 *
 * Two hundred numbers is not a picture. The families are, and each collapses to
 * one figure a reader can hold: how long the sentences run, how heavily the
 * prose is punctuated, how far the narrator stands back. The detail is still
 * there underneath for anything that asks.
 */
const STRANDS: { key: string; name: string; of: string; from: string[] }[] = [
  { key: "length", name: "Sentence length", of: "words", from: ["sent.mean"] },
  { key: "variety", name: "Variety", of: "spread", from: ["sent.sd"] },
  { key: "punctuation", name: "Punctuation", of: "per sentence", from: ["punct.comma"] },
  { key: "paragraph", name: "Paragraph length", of: "words", from: ["para.words"] },
  { key: "vocabulary", name: "Vocabulary", of: "range", from: ["lex.ttr"] },
  { key: "wordlength", name: "Word length", of: "syllables", from: ["lex.syllables"] },
  { key: "latinate", name: "Latinate", of: "per 100 words", from: ["lex.latinate"] },
  { key: "dialogue", name: "Speech tags", of: "per 1000", from: ["tag.rate"] },
  { key: "distance", name: "Filtering", of: "per 1000", from: ["pov.filtering"] },
  { key: "adverbs", name: "-ly adverbs", of: "per 1000", from: ["mod.adverb"] },
  { key: "hedging", name: "Hedging", of: "per 1000", from: ["mod.hedge"] },
  { key: "negation", name: "Negation", of: "per 1000", from: ["mod.negation"] },
];

function strandsOf(norms: Record<string, { mean: number; sd: number }>) {
  return STRANDS.map((strand) => {
    const source = strand.from[0]!;
    const norm = norms[source];
    return {
      key: strand.key,
      name: strand.name,
      unit: strand.of,
      value: norm?.mean ?? 0,
      spread: norm?.sd ?? 0,
    };
  });
}
