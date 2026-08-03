import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { blocks, bookmarks } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";

export async function bookmarksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/works/:workId/bookmarks", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const rows = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.workId, workId))
      .orderBy(asc(bookmarks.sortKey));
    return { bookmarks: rows };
  });

  app.post("/works/:workId/bookmarks", async (req, reply) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        blockId: z.string().uuid(),
        name: z.string().max(200).optional(),
        description: z.string().max(2000).optional(),
        /** Which paragraph in the block, if the writer dropped it on a line. */
        paragraphIndex: z.number().int().min(0).optional(),
        /** Its opening words, so it can be found again if paragraphs shift. */
        paragraphText: z.string().max(400).optional(),
      })
      .parse(req.body);

    const [block] = await db
      .select({ id: blocks.id, workId: blocks.workId, label: blocks.label, text: blocks.contentText })
      .from(blocks)
      .where(eq(blocks.id, body.blockId))
      .limit(1);
    if (!block || block.workId !== workId) throw notFound("block");

    // Named after whatever the block already says, so a bookmark dropped in a
    // hurry is still recognisable before it gets a proper name.
    const fallback =
      block.label?.trim() || block.text.trim().split(/\s+/).slice(0, 6).join(" ") || "Bookmark";

    const existing = await db
      .select({ sortKey: bookmarks.sortKey })
      .from(bookmarks)
      .where(eq(bookmarks.workId, workId))
      .orderBy(asc(bookmarks.sortKey));

    const [row] = await db
      .insert(bookmarks)
      .values({
        workId,
        blockId: body.blockId,
        name: (body.name ?? fallback).slice(0, 200),
        description: body.description?.trim() || null,
        paragraphIndex: body.paragraphIndex ?? null,
        // Kept only alongside an index; on its own it anchors nothing.
        paragraphText:
          body.paragraphIndex === undefined ? null : (body.paragraphText?.slice(0, 400) ?? null),
        sortKey: generateKeyBetween(existing[existing.length - 1]?.sortKey ?? null, null),
      })
      .returning();
    if (!row) throw badRequest("could not create the bookmark");
    reply.status(201);
    return { bookmark: row };
  });

  app.patch("/bookmarks/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
      })
      .parse(req.body);
    const [row] = await db
      .update(bookmarks)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description?.trim() || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(bookmarks.id, id))
      .returning();
    if (!row) throw notFound("bookmark");
    return { bookmark: row };
  });

  app.delete("/bookmarks/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [row] = await db.delete(bookmarks).where(eq(bookmarks.id, id)).returning({ id: bookmarks.id });
    if (!row) throw notFound("bookmark");
    return { ok: true };
  });
}
