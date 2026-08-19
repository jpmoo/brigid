import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DEFAULT_PAGE_SETUP } from "@brigid/shared";
import { templates, workLevels, works } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";

/**
 * The levels a new work starts with. Most novels have no parts, so Chapter /
 * Scene is the useful default — a Part level can be added on top later, and
 * because breaks are derived from depth rather than stored on blocks, adding one
 * re-renders the manuscript without touching a single block.
 */
const DEFAULT_LEVELS = [
  { depth: 0, name: "Chapter", builtinKey: "chapter-break", counterRestart: "continuous" },
  { depth: 1, name: "Scene", builtinKey: "section-break", counterRestart: "under-parent" },
] as const;

const workInput = z.object({
  title: z.string().min(1).max(500),
  subtitle: z.string().max(500).nullable().optional(),
  authorFirstName: z.string().max(200).nullable().optional(),
  authorLastName: z.string().max(200).nullable().optional(),
});

/** How many blocks each work holds — what a delete confirmation needs to say. */
async function blockCountsByWork(): Promise<Map<string, number>> {
  const rows = await db.execute<{ work_id: string; total: string }>(sql`
    SELECT work_id, COUNT(*) AS total FROM blocks GROUP BY work_id
  `);
  return new Map(rows.map((r) => [r.work_id, Number(r.total)]));
}

/**
 * Manuscript totals, counted only from blocks whose format opts in — a title
 * page shouldn't inflate the number the writer is watching. Breaks never carry
 * a block row at all, so they can't contribute by construction.
 */
async function wordCountsByWork(): Promise<Map<string, number>> {
  const rows = await db.execute<{ work_id: string; total: string }>(sql`
    SELECT b.work_id, COALESCE(SUM(b.word_count), 0) AS total
    FROM blocks b
    JOIN templates t ON t.id = b.format_id
    WHERE (t.format_settings ->> 'countsTowardWordCount')::boolean IS TRUE
    GROUP BY b.work_id
  `);
  return new Map(rows.map((r) => [r.work_id, Number(r.total)]));
}

/**
 * When each manuscript was last written in.
 *
 * Not `works.updated_at`, which only moves when the work's own row changes —
 * its title, its page setup. Writing a chapter touches a block, so the answer
 * is the most recent of the two, and a manuscript that has been written in
 * today doesn't claim it was last touched the day it was created.
 */
async function lastEditedByWork(): Promise<Map<string, string>> {
  const rows = await db.execute<{ work_id: string; at: string }>(sql`
    SELECT work_id, MAX(updated_at) AS at FROM blocks GROUP BY work_id
  `);
  return new Map(rows.map((r) => [r.work_id, r.at]));
}

export async function worksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /**
   * When the writing happened, added and deleted kept apart.
   *
   * Two grains, because the two kinds of goal ask different questions. A
   * sitting is an hour long and wants minutes; a target for the book is months
   * long and wants days. Rolled up in the database rather than in the browser:
   * a year of work is tens of thousands of minutes and about three hundred
   * days, and there is no reason to send the first to draw the second.
   *
   * Days are cut in the viewer's own zone. A day is a thing a person had, and
   * someone who works past midnight should see the night they remember rather
   * than whatever UTC made of it.
   */
  app.get("/works/:workId/activity", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { by, days, zone } = z
      .object({
        by: z.enum(["minute", "day"]).default("day"),
        days: z.coerce.number().int().min(1).max(3650).default(90),
        zone: z.string().max(64).default("UTC"),
      })
      .parse(req.query);

    const [work] = await db.select({ id: works.id }).from(works).where(eq(works.id, workId)).limit(1);
    if (!work) throw notFound("work");

    // An IANA name from the browser. Tried rather than trusted; anything
    // Postgres will not accept falls back to UTC instead of failing the page.
    let safeZone = zone;
    try {
      await db.execute(sql`SELECT now() AT TIME ZONE ${safeZone}`);
    } catch {
      safeZone = "UTC";
    }

    const bucket =
      by === "minute" ? sql`minute` : sql`date_trunc('day', minute AT TIME ZONE ${safeZone})`;

    const buckets = await db.execute<{ at: string; added: number; deleted: number }>(sql`
      SELECT ${bucket} AS at,
             sum(added)::int AS added,
             sum(deleted)::int AS deleted
      FROM writing_activity
      WHERE work_id = ${workId}
        AND minute >= now() - make_interval(days => ${days})
      GROUP BY 1
      ORDER BY 1`);

    /**
     * Where the record begins, so the graph can say so.
     *
     * An empty stretch before this is not a quiet week — it is a time nobody
     * was counting, and a chart that draws those the same way is lying.
     */
    const started = await db.execute<{ at: string | null }>(sql`
      SELECT min(minute) AS at FROM writing_activity WHERE work_id = ${workId}`);

    return { by, zone: safeZone, since: started[0]?.at ?? null, buckets };
  });

  app.get("/works", async (req) => {
    requireUser(req);
    const { archived } = z
      .object({ archived: z.enum(["true", "false"]).optional() })
      .parse(req.query ?? {});

    const rows = await db
      .select()
      .from(works)
      .where(archived === "true" ? sql`${works.archivedAt} IS NOT NULL` : isNull(works.archivedAt))
      .orderBy(asc(works.title));

    const [counts, blockCounts, edited] = await Promise.all([
      wordCountsByWork(),
      blockCountsByWork(),
      lastEditedByWork(),
    ]);
    return {
      works: rows.map((w) => {
        const inBlocks = edited.get(w.id);
        const own = w.updatedAt.toISOString();
        return {
          ...w,
          wordCount: counts.get(w.id) ?? 0,
          blockCount: blockCounts.get(w.id) ?? 0,
          lastEditedAt:
            inBlocks && new Date(inBlocks) > new Date(own) ? new Date(inBlocks).toISOString() : own,
        };
      }),
    };
  });

  app.post("/works", async (req, reply) => {
    requireUser(req);
    const body = workInput.parse(req.body);

    const breakTemplates = await db
      .select({ id: templates.id, builtinKey: templates.builtinKey })
      .from(templates)
      .where(eq(templates.category, "break"));
    const byKey = new Map(breakTemplates.map((t) => [t.builtinKey, t.id]));

    const created = await db.transaction(async (tx) => {
      const [work] = await tx
        .insert(works)
        .values({
          title: body.title,
          subtitle: body.subtitle ?? null,
          authorFirstName: body.authorFirstName ?? null,
          authorLastName: body.authorLastName ?? null,
          pageSetup: DEFAULT_PAGE_SETUP,
        })
        .returning();
      if (!work) throw badRequest("could not create the work");

      await tx.insert(workLevels).values(
        DEFAULT_LEVELS.map((level) => ({
          workId: work.id,
          depth: level.depth,
          name: level.name,
          breakTemplateId: byKey.get(level.builtinKey) ?? null,
          counterRestart: level.counterRestart,
        })),
      );

      return work;
    });

    reply.status(201);
    return { work: { ...created, wordCount: 0 } };
  });

  app.get("/works/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const [work] = await db.select().from(works).where(eq(works.id, id)).limit(1);
    if (!work) throw notFound("work");

    const levels = await db
      .select()
      .from(workLevels)
      .where(eq(workLevels.workId, id))
      .orderBy(asc(workLevels.depth));

    const counts = await wordCountsByWork();
    return { work: { ...work, wordCount: counts.get(work.id) ?? 0 }, levels };
  });

  app.patch("/works/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = workInput
      .partial()
      // Null cancels the goal rather than deleting anything, so there is never
      // a second one to reconcile with the first.
      .extend({ totalWordGoal: z.number().int().min(1).max(100000000).nullable().optional() })
      .parse(req.body);

    const [updated] = await db
      .update(works)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(works.id, id))
      .returning();
    if (!updated) throw notFound("work");
    return { work: updated };
  });

  /**
   * Permanent, and reachable only from the archive.
   *
   * Requiring a work to be archived first means deleting is never something
   * that can happen from the shelf you look at every day — it takes a
   * deliberate move out of the way, and only then can it be destroyed.
   */
  app.delete("/works/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const [work] = await db
      .select({ id: works.id, title: works.title, archivedAt: works.archivedAt })
      .from(works)
      .where(eq(works.id, id))
      .limit(1);
    if (!work) throw notFound("work");
    if (!work.archivedAt) {
      throw badRequest("archive this work before deleting it");
    }

    // blocks and work_levels both cascade from works.
    await db.delete(works).where(eq(works.id, id));
    return { ok: true, title: work.title };
  });

  /** Archive and restore share a route: the library needs both, symmetrically. */
  app.post("/works/:id/archive", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body ?? {});

    const [updated] = await db
      .update(works)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(works.id, id)))
      .returning();
    if (!updated) throw notFound("work");
    return { work: updated };
  });
}
