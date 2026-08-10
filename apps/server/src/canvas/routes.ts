import { and, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { blocks, canvasNodes, works } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { notFound } from "../lib/errors.js";

/**
 * Where things sit on the canvas.
 *
 * Only positions. The outline decides what contains what and what follows what,
 * so nothing here can change the manuscript — which is the point: the arrows are
 * worked out from the outline and redraw the moment anything is reordered,
 * without a single stored connection to keep in step.
 *
 * A block with no row has never been placed. Rather than inventing a position
 * here, the canvas lays those out from their place in the outline the first time
 * it draws them, and writes back what it chose.
 */

const PLACEMENT = z.object({
  blockId: z.string().uuid(),
  x: z.number().finite(),
  y: z.number().finite(),
  // Nothing may be saved smaller than a thing you could grab: a node too small
  // to see is a node that cannot be dragged back.
  w: z.number().finite().min(40),
  h: z.number().finite().min(30),
  // Where the block's own prose sits inside the region it heads, when it has
  // children. Absent on a block that is not drawn as a region.
  selfX: z.number().finite().nullish(),
  selfY: z.number().finite().nullish(),
  selfW: z.number().finite().min(40).nullish(),
  selfH: z.number().finite().min(30).nullish(),
});

export async function canvasRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  async function workOr404(workId: string) {
    const [work] = await db.select().from(works).where(eq(works.id, workId)).limit(1);
    if (!work) throw notFound("work");
    return work;
  }

  app.get("/works/:workId/canvas", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await workOr404(workId);

    const nodes = await db
      .select({
        blockId: canvasNodes.blockId,
        x: canvasNodes.x,
        y: canvasNodes.y,
        w: canvasNodes.w,
        h: canvasNodes.h,
        selfX: canvasNodes.selfX,
        selfY: canvasNodes.selfY,
        selfW: canvasNodes.selfW,
        selfH: canvasNodes.selfH,
      })
      .from(canvasNodes)
      .where(eq(canvasNodes.workId, workId));

    return { nodes };
  });

  /**
   * Forget every placement and let it be laid out again.
   *
   * Nothing of the manuscript is touched — there is nothing of the manuscript
   * here to touch. The arrangement is the only thing stored, so throwing it
   * away means the canvas draws itself from the outline again, which is what it
   * does the first time it is opened.
   */
  app.delete("/works/:workId/canvas", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await workOr404(workId);
    await db.delete(canvasNodes).where(eq(canvasNodes.workId, workId));
    return { ok: true as const };
  });

  /**
   * Save placements, several at a time.
   *
   * A batch, because one drag moves more than one thing: dropping a scene grows
   * the chapter around it, which may grow the part around that. Sent separately,
   * the canvas could be caught halfway.
   */
  app.put("/works/:workId/canvas", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const { nodes } = z.object({ nodes: z.array(PLACEMENT).max(2000) }).parse(req.body);
    await workOr404(workId);
    if (nodes.length === 0) return { ok: true as const, saved: 0 };

    /**
     * Only blocks of this manuscript, checked rather than trusted. The ids
     * arrive from the browser, and a placement pointing at a block in another
     * work would otherwise be stored quite happily.
     */
    const owned = await db
      .select({ id: blocks.id })
      .from(blocks)
      .where(
        and(
          eq(blocks.workId, workId),
          inArray(
            blocks.id,
            nodes.map((n) => n.blockId),
          ),
        ),
      );
    const mine = new Set(owned.map((b) => b.id));
    const wanted = nodes.filter((n) => mine.has(n.blockId));
    if (wanted.length === 0) return { ok: true as const, saved: 0 };

    await db
      .insert(canvasNodes)
      .values(
        wanted.map((n) => ({
          ...n,
          selfX: n.selfX ?? null,
          selfY: n.selfY ?? null,
          selfW: n.selfW ?? null,
          selfH: n.selfH ?? null,
          workId,
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: canvasNodes.blockId,
        set: {
          x: sql`excluded.x`,
          y: sql`excluded.y`,
          w: sql`excluded.w`,
          h: sql`excluded.h`,
          /**
           * Kept when the incoming row says nothing about it. A drag of the
           * region sends no self position, and coalescing to the new value
           * would throw away where the opening had been put.
           */
          selfX: sql`coalesce(excluded.self_x, ${canvasNodes.selfX})`,
          selfY: sql`coalesce(excluded.self_y, ${canvasNodes.selfY})`,
          selfW: sql`coalesce(excluded.self_w, ${canvasNodes.selfW})`,
          selfH: sql`coalesce(excluded.self_h, ${canvasNodes.selfH})`,
          updatedAt: new Date(),
        },
      });

    return { ok: true as const, saved: wanted.length };
  });
}
