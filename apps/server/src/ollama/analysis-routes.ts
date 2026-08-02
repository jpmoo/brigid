import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  analyses,
  characterRuns,
  digestState,
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
  proposeReassignment,
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
  /**
   * What should become of a non-character's record.
   *
   * A proposal only — nothing is written. The actions recorded against a crowd
   * or a mistaken title still happened, and dropping them would quietly weaken
   * every profile that should have had them.
   *
   * Run in the request rather than queued, unlike everything else here: the
   * input is one entry's action list rather than a whole book, the writer is
   * waiting on the answer to approve it, and a proposal nobody is looking at is
   * worth nothing. The model call is capped below the proxy's limit so it fails
   * cleanly instead of past it.
   */
  /** Who in this cast is the same person. A proposal; nothing is written. */
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
      /** Where each section sits, so the queue can be read in book order. */
      sections: sections.map((s) => ({
        blockId: s.blockId,
        label: s.label,
        start: s.start,
      })),
    };
  });

  /**
   * Settle the queue.
   *
   * Profiles are scored from committed rows, so this is the moment the record
   * changes — and every profile of a character whose record just moved is
   * answering a question nobody is asking any more. They are deleted rather
   * than marked stale: a chart built on actions that have since been reassigned
   * is not a weaker answer, it is the wrong one.
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
   * Fold the approved groups together.
   *
   * Every recorded name in a group becomes the canonical one, in the reading
   * itself, so the merge survives — a fold applied only to today's roster would
   * be undone the next time one of those sections was re-read. Actions are
   * unioned rather than concatenated: the same act recorded under two names is
   * one act.
   *
   * The profiles of everyone involved go, since a profile of half a person is
   * answering a question nobody asked, and the canonical names are re-queued.
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

    /** Folded name → the name it becomes. */
    const becomes = new Map<string, string>();
    for (const group of groups) {
      for (const name of group.names) becomes.set(foldName(name), group.canonical);
    }

    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ blockId: sectionDigests.blockId, characters: sectionDigests.characters })
        .from(sectionDigests)
        .where(eq(sectionDigests.workId, workId));

      for (const row of rows) {
        if (!row.characters.some((c) => becomes.has(foldName(c.name)))) continue;

        const merged = new Map<string, (typeof row.characters)[number]>();
        for (const character of row.characters) {
          const name = becomes.get(foldName(character.name)) ?? character.name;
          const key = foldName(name);
          const held = merged.get(key);
          if (!held) {
            merged.set(key, {
              ...character,
              name,
              // The name this section actually used is worth keeping.
              aliases: [
                ...new Set([
                  ...(character.aliases ?? []),
                  ...(character.name !== name ? [character.name] : []),
                ]),
              ],
            });
            continue;
          }
          held.aliases = [
            ...new Set([...(held.aliases ?? []), ...(character.aliases ?? []), character.name]),
          ].filter(
            (a) => a !== name,
          );
          // Unioned: the same act recorded under two names is one act.
          held.actions = [...new Set([...held.actions, ...character.actions])];
        }

        await tx
          .update(sectionDigests)
          .set({ characters: [...merged.values()], updatedAt: new Date() })
          .where(and(eq(sectionDigests.workId, workId), eq(sectionDigests.blockId, row.blockId)));
      }

      for (const group of groups) {
        for (const name of group.names) {
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

  app.post("/works/:workId/analysis/reassign", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const work = await workOr404(workId);
    const config = await reader();
    const sections = await readyDigest(workId);

    const roster = rosterFromCast(
      await castFor(workId),
      new Map(sections.map((s) => [s.blockId, s.start])),
      await exclusionsFor(workId),
    );
    const cast = roster.filter((r) => foldName(r.name) !== foldName(name)).map((r) => r.name);

    const { result, ms } = await proposeReassignment({
      ...config,
      title: work.title,
      name,
      cast,
      sections,
    });
    return { proposal: result, ms };
  });

  /**
   * Approve it.
   *
   * This is the one thing in Brigid that edits the reading, which costs an
   * afternoon to rebuild — so it happens in a single transaction and touches
   * only what the writer approved. Sections are rewritten in place: the entry's
   * record is removed and each action is appended to whoever it was assigned
   * to, creating that character's record in the section if they had none.
   *
   * Content hashes are deliberately left alone. They describe the prose, which
   * has not changed, and bumping them would make the walker re-read every
   * touched section and undo this.
   */
  app.post("/works/:workId/analysis/reassign/apply", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { name, moves } = z
      .object({
        name: z.string().min(1),
        moves: z.array(
          z.object({
            blockId: z.string().uuid(),
            action: z.string().min(1),
            to: z.string().nullable(),
            why: z.string().optional(),
          }),
        ),
      })
      .parse(req.body);
    await workOr404(workId);

    const wanted = foldName(name);
    const affected = [...new Set(moves.map((m) => m.to).filter((t): t is string => Boolean(t)))];

    await db.transaction(async (tx) => {
      const rows = await tx
        .select({ blockId: sectionDigests.blockId, characters: sectionDigests.characters })
        .from(sectionDigests)
        .where(eq(sectionDigests.workId, workId));

      for (const row of rows) {
        const mine = moves.filter((m) => m.blockId === row.blockId);
        const holdsIt = row.characters.some((c) => foldName(c.name) === wanted);
        if (!holdsIt && mine.length === 0) continue;

        // Out with the entry itself.
        const characters = row.characters.filter((c) => foldName(c.name) !== wanted);

        for (const move of mine) {
          if (!move.to) continue;
          const target = characters.find((c) => foldName(c.name) === foldName(move.to!));
          if (target) {
            if (!target.actions.includes(move.action)) target.actions.push(move.action);
          } else {
            // The recipient wasn't recorded in this section, but the action
            // says they were there.
            characters.push({ name: move.to, aliases: [], actions: [move.action] });
          }
        }

        await tx
          .update(sectionDigests)
          .set({ characters, updatedAt: new Date() })
          .where(
            and(eq(sectionDigests.workId, workId), eq(sectionDigests.blockId, row.blockId)),
          );
      }

      await tx
        .insert(excludedCharacters)
        .values({ workId, nameFolded: wanted, name: name.trim() })
        .onConflictDoNothing();

      /**
       * The entry's own profile, and every profile that just gained actions.
       * A profile scored before the record changed is answering a question that
       * is no longer being asked.
       */
      for (const subject of [name, ...affected]) {
        await tx
          .delete(analyses)
          .where(
            and(
              eq(analyses.workId, workId),
              eq(analyses.kind, "character"),
              eq(analyses.subject, subject),
            ),
          );
      }
    });

    // Only the recipients, and only after the rewrite is committed.
    if (affected.length > 0) {
      const sections = await placedDigests(workId);
      await queueCharacterRun(workId, affected, fingerprint(sections), affected[0]!);
    }

    return { ok: true as const, reprofiling: affected };
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
