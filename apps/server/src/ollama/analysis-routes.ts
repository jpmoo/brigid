import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { analyses, settings, works } from "@brigid/db";
import type { CharacterAnalysis, PlacedDigest } from "@brigid/shared";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";
import { analyseCharacter, analyseStructure, buildRoster, reconcilePrimacy } from "./analysis.js";
import { AXIS_LABELS, MODEL_LABELS } from "./frameworks.js";
import { placedDigests, progressOf } from "./worker.js";

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
  result: unknown,
  ms: number,
): Promise<void> {
  const values = {
    workId,
    kind,
    subject,
    model,
    digestFingerprint,
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

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /** Everything the panel needs to draw itself in one call. */
  app.get("/works/:workId/analysis", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await workOr404(workId);

    const progress = await progressOf(workId);
    const sections = await placedDigests(workId);
    const stored = await db.select().from(analyses).where(eq(analyses.workId, workId));
    const mark = fingerprint(sections);

    return {
      progress,
      roster: buildRoster(sections),
      // Labels travel with the findings so the web app doesn't keep a second
      // copy of the frameworks' names that could drift from this one.
      axisLabels: AXIS_LABELS,
      modelLabels: MODEL_LABELS,
      reports: stored.map((row) => ({
        kind: row.kind,
        subject: row.subject,
        model: row.model,
        result: row.result,
        createdAt: row.createdAt,
        /** False once the manuscript has moved on since this was judged. */
        current: row.digestFingerprint === mark,
      })),
    };
  });

  app.post("/works/:workId/analysis/structure", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const work = await workOr404(workId);
    const config = await reader();
    const sections = await readyDigest(workId);

    const { result, ms } = await analyseStructure({
      ...config,
      title: work.title,
      totalWords: sections.reduce((sum, s) => sum + s.words, 0),
      sections,
    });

    await store(workId, "structure", null, config.model, fingerprint(sections), result, ms);
    return { result, ms };
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
    const roster = buildRoster(sections);
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

    const profiles: CharacterAnalysis[] = [];
    let ms = 0;
    for (const entry of wanted) {
      const one = await analyseCharacter({
        ...config,
        title: work.title,
        name: entry.name,
        focal,
        sections,
      });
      profiles.push(one.result);
      ms += one.ms;
    }

    // Only meaningful across a whole cast; harmless for a single re-run.
    const settled = wanted.length > 1 ? reconcilePrimacy(profiles) : profiles;
    const mark = fingerprint(sections);
    for (const profile of settled) {
      await store(workId, "character", profile.name, config.model, mark, profile, ms);
    }

    return { results: settled, ms };
  });

  app.delete("/works/:workId/analysis", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { kind } = z
      .object({ kind: z.enum(["structure", "character"]).optional() })
      .parse(req.query ?? {});
    await db
      .delete(analyses)
      .where(kind ? and(eq(analyses.workId, workId), eq(analyses.kind, kind)) : eq(analyses.workId, workId));
    return { ok: true as const };
  });
}
