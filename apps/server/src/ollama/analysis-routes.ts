import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  analyses,
  characterRuns,
  digestState,
  castActions,
  sectionDigests,
  settings,
  structureRuns,
  works,
  excludedCharacters,
} from "@brigid/db";
import type { AnalysisDrift, CharacterAnalysis, PlacedDigest } from "@brigid/shared";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import {
  analyseStructure,
  buildRoster,
  foldName,
  rosterFromCast,
  proposeIdentities,
} from "./analysis.js";
import {
  cancelCharacterRun,
  characterProgressOf,
  queueCharacterRun,
  queueStructureRun,
  structureProgressOf,
} from "./profile-worker.js";
import { AXIS_BLURBS, AXIS_LABELS, MODEL_BLURBS, MODEL_LABELS } from "./frameworks.js";
import { placedDigests, progressOf } from "./worker.js";
import { backfill, castFor, commitCast, pendingCount } from "./cast.js";

/**
 * Running the frameworks over a finished digest.
 *
 * Analysis is on request rather than automatic. The walk has to keep up with
 * the writing, so it runs itself; judging is a question somebody asks, and
 * asking it costs minutes of a GPU that the writer may be using for something
 * else.
 */

/** What the findings were judged from, so a stale report can say so. */
function fingerprint(sections: PlacedDigest[]): string {
  const material = sections
    .map((s) => `${s.blockId}:${s.start.toFixed(4)}:${s.events.length}:${s.characters.length}`)
    .join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/**
 * Each section as it stands: what it is, what the digest found there, and how
 * long it is. Stored with a report so drift can later be measured against it.
 */
function snapshot(sections: PlacedDigest[]): [string, string, number][] {
  return sections.map((s) => [
    s.blockId,
    `${s.events.length}:${s.characters.length}:${s.words}`,
    s.words,
  ]);
}

/**
 * How much of the book has moved since a report was written.
 *
 * Counted in words rather than sections, because sections are not the same
 * size: rewriting a 4,000-word chapter and retitling a 90-word interstitial are
 * both "one section changed" and are not remotely the same news. Deleted
 * sections count their old length, added ones their new — both are work the
 * report has not seen.
 */
function driftFrom(
  before: [string, string, number][] | null,
  after: [string, string, number][],
): AnalysisDrift {
  const now = after.reduce((sum, [, , w]) => sum + w, 0);
  if (!before) return { words: 0, fraction: 0, sections: 0, measurable: false };

  const was = new Map(before.map(([id, sig, w]) => [id, { sig, w }]));
  let words = 0;
  let count = 0;

  for (const [id, sig, w] of after) {
    const held = was.get(id);
    if (!held) {
      words += w;
      count += 1;
    } else if (held.sig !== sig) {
      // The larger of the two: a chapter cut from 4,000 words to 100 has moved
      // 4,000 words' worth, not 100.
      words += Math.max(w, held.w);
      count += 1;
    }
    was.delete(id);
  }
  // Whatever is left was deleted.
  for (const [, held] of was) {
    words += held.w;
    count += 1;
  }

  return {
    words,
    fraction: now > 0 ? Math.min(1, words / now) : 0,
    sections: count,
    measurable: true,
  };
}

async function reader() {
  const [row] = await db
    .select({
      url: settings.ollamaUrl,
      model: settings.inferenceModel,
      numCtx: settings.ollamaNumCtx,
      thinks: settings.ollamaThinks,
    })
    .from(settings)
    .limit(1);
  if (!row?.url || !row.model) throw badRequest("no model is connected");
  return { url: row.url, model: row.model, numCtx: row.numCtx, thinks: row.thinks };
}

async function workOr404(workId: string) {
  const [work] = await db
    .select({ id: works.id, title: works.title })
    .from(works)
    .where(eq(works.id, workId))
    .limit(1);
  if (!work) throw notFound("no such manuscript");
  return work;
}

/** The digest, or a clear refusal if it isn't finished. */
async function readyDigest(workId: string): Promise<PlacedDigest[]> {
  const progress = await progressOf(workId);
  if (!progress.ready) {
    throw badRequest(
      progress.total === 0
        ? "there is nothing written to analyse yet"
        : `still reading — ${progress.done} of ${progress.total} sections done`,
    );
  }
  return placedDigests(workId);
}

async function store(
  workId: string,
  kind: "structure" | "character",
  subject: string | null,
  model: string,
  digestFingerprint: string,
  digestSnapshot: [string, string, number][],
  result: unknown,
  ms: number,
): Promise<void> {
  const values = {
    workId,
    kind,
    subject,
    model,
    digestFingerprint,
    digestSnapshot,
    result: result as Record<string, unknown>,
    ms,
    createdAt: new Date(),
  };
  // Replace rather than upsert: the natural key includes a nullable column, and
  // null is not equal to null, so there is no conflict target that would catch
  // a repeated structure report. One transaction, so a re-run that fails leaves
  // the previous findings in place rather than nothing at all.
  await db.transaction(async (tx) => {
    await tx
      .delete(analyses)
      .where(
        and(
          eq(analyses.workId, workId),
          eq(analyses.kind, kind),
          subject === null ? isNull(analyses.subject) : eq(analyses.subject, subject),
        ),
      );
    await tx.insert(analyses).values(values);
  });
}

/** The folded names this manuscript's writer has ruled are not characters. */
async function exclusionsFor(workId: string): Promise<string[]> {
  const rows = await db
    .select({ folded: excludedCharacters.nameFolded })
    .from(excludedCharacters)
    .where(eq(excludedCharacters.workId, workId));
  return rows.map((r) => r.folded);
}

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /** Everything the panel needs to draw itself in one call. */
  app.get("/works/:workId/analysis", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await workOr404(workId);

    const progress = await progressOf(workId);
    const sections = await placedDigests(workId);

    /**
     * Fill the queue from whatever has already been read.
     *
     * The queue was added after the reading was, so a manuscript read before
     * this existed has digests and no rows. Backfilling here rather than in a
     * migration means it also covers a walk that was already under way when the
     * server restarted — the sections read before the restart never passed
     * through the sync. Safe to repeat: an already-synced section hits the
     * unique constraint and does nothing.
     */
    await backfill(workId);
    const stored = await db.select().from(analyses).where(eq(analyses.workId, workId));
    const mark = fingerprint(sections);
    const now = snapshot(sections);

    return {
      progress,
      characterRun: await characterProgressOf(workId),
      pendingActions: await pendingCount(workId),
      structureRun: await structureProgressOf(workId),
      /**
       * From what the writer has committed, not from the reading. An action
       * they moved or dropped is reflected here and nowhere else has to know.
       */
      roster: rosterFromCast(
        await castFor(workId),
        new Map(sections.map((s) => [s.blockId, s.start])),
        await exclusionsFor(workId),
      ),
      // Labels travel with the findings so the web app doesn't keep a second
      // copy of the frameworks' names that could drift from this one.
      axisLabels: AXIS_LABELS,
      modelLabels: MODEL_LABELS,
      // What each framework and axis actually claims, so a rating can be read
      // against its rubric rather than taken as a bare grade.
      axisBlurbs: AXIS_BLURBS,
      modelBlurbs: MODEL_BLURBS,
      reports: stored.map((row) => ({
        kind: row.kind,
        subject: row.subject,
        model: row.model,
        result: row.result,
        createdAt: row.createdAt,
        /** False once the manuscript has moved on since this was judged. */
        current: row.digestFingerprint === mark,
        /** And by how much — so a typo doesn't read like a rewrite. */
        drift: driftFrom(row.digestSnapshot ?? null, now),
      })),
    };
  });

  app.post("/works/:workId/analysis/structure", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await workOr404(workId);
    // Checked here so a misconfigured host fails at the button rather than
    // silently in a worker twenty seconds later.
    await reader();
    const sections = await readyDigest(workId);

    /**
     * Queued, not run. One call rather than a dozen, so this used to fit inside
     * the request — but only for a book the model could get through quickly,
     * and it tied the analysis to a page nobody could leave.
     */
    await queueStructureRun(workId, fingerprint(sections));
    return { progress: await structureProgressOf(workId) };
  });

  /**
   * One character, or the whole judgeable cast.
   *
   * Doing the cast in one request is what makes the primacy rule enforceable:
   * the rubric says only one character ordinarily carries a 5 on an axis, and
   * that cannot be settled by a model looking at one profile at a time.
   */
  app.post("/works/:workId/analysis/character", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ name: z.string().min(1).max(200).optional(), focal: z.string().max(200).optional() })
      .parse(req.body ?? {});

    const work = await workOr404(workId);
    const config = await reader();
    const sections = await readyDigest(workId);
    const roster = rosterFromCast(
      await castFor(workId),
      new Map(sections.map((s) => [s.blockId, s.start])),
      await exclusionsFor(workId),
    );
    const judgeable = roster.filter((r) => r.judgeable);

    if (judgeable.length === 0) {
      throw badRequest(
        "no character has enough recorded action to score a profile against — the roster says who and why",
      );
    }

    // Unstated, the focal perspective is whoever the book attends to most.
    const focal = body.focal ?? judgeable[0]!.name;

    const wanted = body.name
      ? judgeable.filter((r) => r.name.toLowerCase() === body.name!.toLowerCase())
      : judgeable;

    if (wanted.length === 0) {
      const listed = roster.find((r) => r.name.toLowerCase() === body.name!.toLowerCase());
      throw badRequest(
        listed?.reason
          ? `${listed.name} ${listed.reason}`
          : `${body.name} isn't among the characters the reading found`,
      );
    }

    /**
     * Queued, not run.
     *
     * One model call per character makes this an hour's work on a full cast,
     * and nothing in front of the server will hold a request open that long —
     * Cloudflare cuts one off at a hundred seconds. So the queue is recorded
     * and the answer is immediate; the worker writes each profile as it lands
     * and the panel watches it happen.
     */
    await queueCharacterRun(
      workId,
      wanted.map((r) => r.name),
      fingerprint(sections),
      focal,
    );

    return { queued: wanted.map((r) => r.name), progress: await characterProgressOf(workId) };
  });

  /** Stop a run. What it has already written stays. */
  app.delete("/works/:workId/analysis/characters/run", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await workOr404(workId);
    await cancelCharacterRun(workId);
    return { progress: await characterProgressOf(workId) };
  });

  /**
   * One character's profile, thrown away.
   *
   * Separate from clearing everything because the reasons differ: a profile is
   * usually dismissed because it is wrong about someone, or because the roster
   * has since folded two names together and left a profile under the old one.
   * The reading is untouched, so re-running is one model call rather than an
   * afternoon.
   */
  /**
   * Rule that something the reading called a character is not one.
   *
   * Recorded rather than acted on once: the walker re-reads changed sections and
   * would reintroduce the entry every time its chapter was edited. Its profile
   * goes with it, since a profile of a crowd is not worth keeping.
   */
  app.post("/works/:workId/analysis/not-a-character", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    await workOr404(workId);

    await db.transaction(async (tx) => {
      await tx
        .insert(excludedCharacters)
        .values({ workId, nameFolded: foldName(name), name: name.trim() })
        .onConflictDoNothing();
      await tx
        .delete(analyses)
        .where(
          and(eq(analyses.workId, workId), eq(analyses.kind, "character"), eq(analyses.subject, name)),
        );
    });
    return { ok: true as const };
  });

  /** Put one back. The name returns on the next read of any section naming it. */
  app.delete("/works/:workId/analysis/not-a-character/:name", async (req) => {
    requireUser(req);
    const { workId, name } = z
      .object({ workId: z.string().uuid(), name: z.string().min(1) })
      .parse(req.params);
    await workOr404(workId);
    await db
      .delete(excludedCharacters)
      .where(
        and(eq(excludedCharacters.workId, workId), eq(excludedCharacters.nameFolded, foldName(name))),
      );
    return { ok: true as const };
  });

  app.delete("/works/:workId/analysis/character/:name", async (req) => {
    requireUser(req);
    const { workId, name } = z
      .object({ workId: z.string().uuid(), name: z.string().min(1) })
      .parse(req.params);
    await workOr404(workId);

    await db
      .delete(analyses)
      .where(
        and(
          eq(analyses.workId, workId),
          eq(analyses.kind, "character"),
          eq(analyses.subject, name),
        ),
      );
    return { ok: true as const };
  });

  app.delete("/works/:workId/analysis", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { kind, everything } = z
      .object({
        kind: z.enum(["structure", "character"]).optional(),
        everything: z.enum(["true", "false"]).optional(),
      })
      .parse(req.query ?? {});

    /**
     * Everything AI-derived, including the reading itself.
     *
     * Done in one transaction, because a half-cleared manuscript is worse than
     * either state: the digest gone and the findings left would leave reports
     * on the page with nothing behind them. Queued runs are stopped in the same
     * breath, or a worker mid-sweep would write a profile back into a
     * manuscript that was just cleared.
     *
     * The prose is untouched. The walker will read it again from scratch.
     */
    /**
     * The character work only: profiles, and every decision about who did what.
     * The reading survives, which is the point — re-reading is the expensive
     * part, and starting the cast again should not cost an afternoon. Settled
     * rows go back to pending rather than being deleted, so nothing gathered is
     * lost, only what was decided about it.
     */
    if (kind === "character" && everything === "true") {
      await db.transaction(async (tx) => {
        await tx
          .delete(analyses)
          .where(and(eq(analyses.workId, workId), eq(analyses.kind, "character")));
        await tx.delete(characterRuns).where(eq(characterRuns.workId, workId));
        await tx
          .update(castActions)
          .set({
            state: "pending",
            characterName: sql`${castActions.originName}`,
            action: sql`${castActions.originAction}`,
            updatedAt: new Date(),
          })
          .where(eq(castActions.workId, workId));
      });
      return { ok: true as const, cleared: "characters" as const };
    }

    if (everything === "true") {
      await db.transaction(async (tx) => {
        await tx.delete(analyses).where(eq(analyses.workId, workId));
        await tx.delete(characterRuns).where(eq(characterRuns.workId, workId));
        await tx.delete(structureRuns).where(eq(structureRuns.workId, workId));
        await tx.delete(sectionDigests).where(eq(sectionDigests.workId, workId));
        await tx.delete(digestState).where(eq(digestState.workId, workId));
      });
      return { ok: true as const, cleared: "everything" as const };
    }

    await db
      .delete(analyses)
      .where(kind ? and(eq(analyses.workId, workId), eq(analyses.kind, kind)) : eq(analyses.workId, workId));
    return { ok: true as const, cleared: kind ?? ("findings" as const) };
  });
}
