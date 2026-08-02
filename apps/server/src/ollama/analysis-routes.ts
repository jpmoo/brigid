import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  analyses,
  blocks,
  characterRuns,
  digestState,
  castActions,
  sectionDigests,
  settings,
  structureRuns,
  works,
  excludedCharacters,
} from "@brigid/db";
import type {
  AnalysisDrift,
  CharacterAnalysis,
  PlacedDigest,
  StructureAnalysis,
} from "@brigid/shared";
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
import { backfill, castFor, commitCast, pendingCount, resetCharacter } from "./cast.js";
import { CHAT_SYSTEM, buildBrief } from "./chat.js";

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
  /** Who in this cast is the same person. A proposal; nothing is written. */
  app.post("/works/:workId/analysis/identities", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const work = await workOr404(workId);
    const config = await reader();
    const sections = await readyDigest(workId);
    const roster = rosterFromCast(
      await castFor(workId),
      new Map(sections.map((s) => [s.blockId, s.start])),
      await exclusionsFor(workId),
    );

    const { result, ms } = await proposeIdentities({
      ...config,
      title: work.title,
      roster,
      sections,
    });
    return { proposal: result, ms };
  });

  /**
   * Fold the approved groups together, on the settled cast.
   *
   * Not on the reading: the sync that keeps the queue current identifies a row
   * by what the reading said and deletes rows that no longer match, so
   * rewriting the digest would throw away every settled decision in each
   * section a merge touched. Only `character_name` moves.
   */
  app.post("/works/:workId/analysis/identities/apply", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { groups } = z
      .object({
        groups: z.array(
          z.object({ canonical: z.string().min(1), names: z.array(z.string().min(1)).min(2) }),
        ),
      })
      .parse(req.body);
    await workOr404(workId);
    if (groups.length === 0) return { ok: true as const, reprofiling: [] };

    await db.transaction(async (tx) => {
      for (const group of groups) {
        for (const name of group.names) {
          if (foldName(name) !== foldName(group.canonical)) {
            await tx
              .update(castActions)
              .set({ characterName: group.canonical, updatedAt: new Date() })
              .where(and(eq(castActions.workId, workId), eq(castActions.characterName, name)));
          }
          await tx
            .delete(analyses)
            .where(
              and(
                eq(analyses.workId, workId),
                eq(analyses.kind, "character"),
                eq(analyses.subject, name),
              ),
            );
        }
      }
    });

    const canonical = [...new Set(groups.map((g) => g.canonical))];
    const sections = await placedDigests(workId);
    await queueCharacterRun(workId, canonical, fingerprint(sections), canonical[0]!);
    return { ok: true as const, reprofiling: canonical };
  });

  /**
   * Talking about the manuscript, streamed.
   *
   * Streamed because an answer of any length outlasts what the proxy in front
   * will hold a silent request open for, and because watching a reply arrive is
   * the difference between a conversation and a form submission. The brief is
   * assembled from findings already made rather than from the prose: they carry
   * positions and judgments that could not be recomputed per question.
   */
  app.post("/works/:workId/chat", async (req, reply) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { messages } = z
      .object({
        messages: z
          .array(
            z.object({
              role: z.enum(["user", "assistant"]),
              content: z.string().min(1).max(8000),
            }),
          )
          .min(1)
          .max(40),
      })
      .parse(req.body);

    const work = await workOr404(workId);
    const config = await reader();
    const sections = await readyDigest(workId);

    const stored = await db.select().from(analyses).where(eq(analyses.workId, workId));
    const structure =
      (stored.find((r) => r.kind === "structure")?.result as StructureAnalysis | undefined) ?? null;
    const profiles = stored
      .filter((r) => r.kind === "character")
      .map((r) => r.result as unknown as CharacterAnalysis);

    if (!structure || profiles.length === 0) {
      throw badRequest("the story shape and at least one character profile are needed first");
    }

    /**
     * The prose itself, for questions the findings cannot reach. A summary of a
     * scene has none of its sentences in it, so nothing derived from the reading
     * can answer a question about the writing.
     */
    const prose = new Map(
      (
        await db
          .select({ id: blocks.id, text: blocks.contentText })
          .from(blocks)
          .where(eq(blocks.workId, workId))
      ).map((b) => [b.id, b.text]),
    );

    const brief = buildBrief(
      {
        title: work.title,
        totalWords: sections.reduce((sum, s) => sum + s.words, 0),
        structure,
        profiles,
        sections,
        prose,
        question: messages.filter((m) => m.role === "user").at(-1)?.content ?? "",
      },
      config.numCtx,
    );

    const answer = await fetch(`${config.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        ...(config.thinks ? { think: false } : {}),
        options: {
          ...(config.numCtx ? { num_ctx: config.numCtx } : {}),
          temperature: 0.4,
        },
        messages: [{ role: "system", content: `${CHAT_SYSTEM}\n\n${brief}` }, ...messages],
      }),
      signal: AbortSignal.timeout(15 * 60_000),
    });

    if (!answer.ok || !answer.body) throw badRequest(`the model answered ${answer.status}`);

    /**
     * Forwarded as plain text rather than re-wrapped. Ollama sends one JSON
     * object per line; the content is pulled out and written straight through,
     * so the browser appends tokens instead of parsing a protocol.
     */
    reply.raw.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });

    const decoder = new TextDecoder();
    let held = "";
    for await (const chunk of answer.body as unknown as AsyncIterable<Uint8Array>) {
      held += decoder.decode(chunk, { stream: true });
      const lines = held.split("\n");
      // The last piece may be half a line; keep it for the next chunk.
      held = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string } };
          if (parsed.message?.content) reply.raw.write(parsed.message.content);
        } catch {
          // A line that isn't JSON is not worth killing the stream over.
        }
      }
    }
    reply.raw.end();
    return reply;
  });

  /** One character back to a blank slate: every line re-queued, profile gone. */
  app.post("/works/:workId/cast/reset", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    await workOr404(workId);

    const restored = await resetCharacter(workId, name);
    await db
      .delete(analyses)
      .where(
        and(eq(analyses.workId, workId), eq(analyses.kind, "character"), eq(analyses.subject, name)),
      );
    return { ok: true as const, restored, pending: await pendingCount(workId) };
  });

  /** Everything gathered, for the reconcile screen. */
  app.get("/works/:workId/cast", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await workOr404(workId);
    await backfill(workId);

    const sections = await placedDigests(workId);
    return {
      rows: await castFor(workId),
      excluded: await exclusionsFor(workId),
      /** Where each section sits, so the queue reads in book order. */
      sections: sections.map((s) => ({ blockId: s.blockId, label: s.label, start: s.start })),
    };
  });

  /**
   * Settle the queue.
   *
   * Profiles are scored from committed rows, so this is the moment the record
   * changes — and every profile of a character whose record just moved is
   * answering a question nobody is asking any more. They are deleted rather
   * than marked stale: a chart built on actions that have since been reassigned
   * is not a weaker answer, it is an answer to a different question.
   */
  app.post("/works/:workId/cast/commit", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { decisions } = z
      .object({
        decisions: z.array(
          z.object({
            id: z.string().uuid(),
            characterName: z.string().max(200).optional(),
            action: z.string().max(2000).optional(),
            drop: z.boolean().optional(),
            restore: z.boolean().optional(),
            assign: z.boolean().optional(),
          }),
        ),
      })
      .parse(req.body);
    await workOr404(workId);

    const touched = await commitCast(workId, decisions);
    for (const subject of touched) {
      await db
        .delete(analyses)
        .where(
          and(
            eq(analyses.workId, workId),
            eq(analyses.kind, "character"),
            eq(analyses.subject, subject),
          ),
        );
    }

    return { ok: true as const, affected: touched, pending: await pendingCount(workId) };
  });

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
