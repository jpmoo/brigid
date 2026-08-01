import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { blocks, templates, workLevels } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";

const bodySchema = z.object({ nodes: z.array(z.unknown()) });

const typography = z
  .object({
    fontFamily: z.string().max(300).optional(),
    fontSizePt: z.number().min(4).max(96).optional(),
    lineHeight: z.number().min(0.8).max(4).optional(),
    align: z.enum(["left", "justify", "center", "right"]).optional(),
    firstLineIndentIn: z.number().min(0).max(3).optional(),
    paragraphSpacingEm: z.number().min(0).max(6).optional(),
  })
  .optional();

const breakSettings = z.object({
  suppressOnFirstChild: z.boolean(),
  indentFirstParagraph: z.boolean().optional(),
  smartPunctuation: z.boolean().optional(),
  typography,
});

const formatSettings = z.object({
  countsTowardWordCount: z.boolean(),
  structural: z.boolean(),
  smartPunctuation: z.boolean().optional(),
  typography,
  sectionStart: z
    .object({
      pageNumbering: z.enum(["continue", "restart"]),
      startPageNumber: z.number().int().min(1).max(100000).optional(),
      runningHeads: z.enum(["continue", "restart", "suppress"]),
    })
    .optional(),
});

export async function templatesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/templates", async (req, reply) => {
    requireUser(req);
    const body = z
      .object({
        category: z.enum(["break", "block-format"]),
        name: z.string().min(1).max(200),
        body: bodySchema,
        breakSettings: breakSettings.optional(),
        formatSettings: formatSettings.optional(),
      })
      .parse(req.body);

    if (body.category === "break" && !body.breakSettings) {
      throw badRequest("a break template needs break settings");
    }
    if (body.category === "block-format" && !body.formatSettings) {
      throw badRequest("a block format needs format settings");
    }

    const [created] = await db
      .insert(templates)
      .values({
        category: body.category,
        name: body.name,
        body: body.body as never,
        breakSettings: (body.breakSettings ?? null) as never,
        formatSettings: (body.formatSettings ?? null) as never,
      })
      .returning();
    reply.status(201);
    return { template: created };
  });

  app.patch("/templates/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        body: bodySchema.optional(),
        breakSettings: breakSettings.optional(),
        formatSettings: formatSettings.optional(),
      })
      .parse(req.body);

    const [current] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
    if (!current) throw notFound("template");

    // Built-ins are editable — only their existence is protected — but the
    // settings blob has to keep matching the category, per the table's check.
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.body !== undefined) patch.body = body.body;
    if (body.breakSettings !== undefined) {
      if (current.category !== "break") throw badRequest("that template is not a break");
      patch.breakSettings = body.breakSettings;
    }
    if (body.formatSettings !== undefined) {
      if (current.category !== "block-format") throw badRequest("that template is not a block format");
      patch.formatSettings = body.formatSettings;
    }

    const [updated] = await db.update(templates).set(patch).where(eq(templates.id, id)).returning();
    return { template: updated };
  });

  app.delete("/templates/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const [current] = await db
      .select({ builtinKey: templates.builtinKey })
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);
    if (!current) throw notFound("template");
    if (current.builtinKey) throw forbidden("built-in templates can be edited but not deleted");

    // A format still in use is referenced by blocks.format_id with ON DELETE
    // RESTRICT; saying so beats surfacing a foreign-key error.
    const [inUse] = await db.select({ id: blocks.id }).from(blocks).where(eq(blocks.formatId, id)).limit(1);
    if (inUse) throw conflict("that format is still used by at least one block");

    await db.delete(templates).where(eq(templates.id, id));
    return { ok: true };
  });

  /**
   * Replace a work's levels wholesale. The outline's depth is the index into
   * this list, so it is edited as an ordered set rather than row by row.
   */
  app.put("/works/:workId/levels", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        levels: z
          .array(
            z.object({
              name: z.string().min(1).max(120),
              breakTemplateId: z.string().uuid().nullable(),
              counterRestart: z.enum(["continuous", "under-parent"]),
            }),
          )
          .min(1)
          .max(12),
      })
      .parse(req.body);

    const saved = await db.transaction(async (tx) => {
      await tx.delete(workLevels).where(eq(workLevels.workId, workId));
      return tx
        .insert(workLevels)
        .values(
          body.levels.map((level, depth) => ({
            workId,
            depth,
            name: level.name,
            breakTemplateId: level.breakTemplateId,
            counterRestart: level.counterRestart,
          })),
        )
        .returning();
    });

    return { levels: saved.sort((a, b) => a.depth - b.depth) };
  });

  app.get("/works/:workId/levels", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const levels = await db
      .select()
      .from(workLevels)
      .where(eq(workLevels.workId, workId))
      .orderBy(asc(workLevels.depth));
    return { levels };
  });
}
