import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { countWords } from "@brigid/shared";
import { blocks, templates, workLevels, works } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../lib/errors.js";

/**
 * Where a new block lands, relative to the block the writer was on.
 *
 * `parent` is one level *shallower* — the new block becomes a sibling of the
 * reference's parent, placed just after it. It doesn't reparent anything; the
 * name matches how the outline reads rather than the tree operation.
 */
const PLACEMENTS = ["root", "sibling", "sibling-before", "child", "parent"] as const;
type Placement = (typeof PLACEMENTS)[number];

const createBody = z.object({
  relativeTo: z.string().uuid().nullable().optional(),
  placement: z.enum(PLACEMENTS).default("root"),
  formatId: z.string().uuid(),
  label: z.string().max(500).nullable().optional(),
});

interface Sibling {
  id: string;
  sortKey: string;
}

async function siblingsOf(
  tx: typeof db,
  workId: string,
  parentId: string | null,
): Promise<Sibling[]> {
  return tx
    .select({ id: blocks.id, sortKey: blocks.sortKey })
    .from(blocks)
    .where(
      and(
        eq(blocks.workId, workId),
        parentId === null ? isNull(blocks.parentId) : eq(blocks.parentId, parentId),
      ),
    )
    .orderBy(asc(blocks.sortKey));
}

/**
 * A key that sorts immediately after `afterId`, or at the end when it's null.
 * Fractional indexing means inserting or moving one block is a single-row
 * update — no renumbering of everything downstream.
 */
function keyAfter(siblings: readonly Sibling[], afterId: string | null): string {
  if (afterId === null) {
    const last = siblings[siblings.length - 1];
    return generateKeyBetween(last?.sortKey ?? null, null);
  }
  const index = siblings.findIndex((s) => s.id === afterId);
  if (index === -1) {
    const last = siblings[siblings.length - 1];
    return generateKeyBetween(last?.sortKey ?? null, null);
  }
  const current = siblings[index];
  const next = siblings[index + 1];
  return generateKeyBetween(current?.sortKey ?? null, next?.sortKey ?? null);
}

/** Plain text of a ProseMirror document, for word counting and search. */
function extractText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const node = doc as { type?: string; text?: string; content?: unknown[] };
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  const parts = node.content.map((child) => extractText(child));
  // Block-level nodes are separate paragraphs; joining with a space keeps the
  // last word of one from fusing with the first of the next.
  return parts.join(node.type === "doc" || node.type === "paragraph" ? " " : "");
}

/** Every descendant of `rootId`, deepest last. Used for cascade-free deletes. */
function descendantsOf(all: readonly { id: string; parentId: string | null }[], rootId: string) {
  const byParent = new Map<string, string[]>();
  for (const b of all) {
    if (!b.parentId) continue;
    const bucket = byParent.get(b.parentId);
    if (bucket) bucket.push(b.id);
    else byParent.set(b.parentId, [b.id]);
  }
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (id === undefined) break;
    for (const child of byParent.get(id) ?? []) {
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

export async function blocksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.get("/works/:workId/blocks", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);

    const rows = await db
      .select()
      .from(blocks)
      .where(eq(blocks.workId, workId))
      .orderBy(asc(blocks.sortKey));

    return { blocks: rows };
  });

  app.post("/works/:workId/blocks", async (req, reply) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    const body = createBody.parse(req.body);

    const [work] = await db.select({ id: works.id }).from(works).where(eq(works.id, workId)).limit(1);
    if (!work) throw notFound("work");

    const [format] = await db
      .select({ id: templates.id, category: templates.category })
      .from(templates)
      .where(eq(templates.id, body.formatId))
      .limit(1);
    if (!format) throw notFound("format template");
    if (format.category !== "block-format") {
      throw badRequest("a block's format must be a block-format template, not a break");
    }

    const created = await db.transaction(async (tx) => {
      let parentId: string | null = null;
      let afterId: string | null = null;

      if (body.placement !== "root") {
        if (!body.relativeTo) throw badRequest(`placement '${body.placement}' needs relativeTo`);
        const [ref] = await tx
          .select({ id: blocks.id, parentId: blocks.parentId, workId: blocks.workId })
          .from(blocks)
          .where(eq(blocks.id, body.relativeTo))
          .limit(1);
        if (!ref || ref.workId !== workId) throw notFound("reference block");

        if (body.placement === "child") {
          // Front matter sits outside the level structure, so nothing can be
          // nested beneath it — a chapter under a title page is meaningless.
          const [refFormat] = await tx
            .select({ formatSettings: templates.formatSettings })
            .from(templates)
            .innerJoin(blocks, eq(blocks.formatId, templates.id))
            .where(eq(blocks.id, ref.id))
            .limit(1);
          if (refFormat && refFormat.formatSettings?.structural === false) {
            throw badRequest("that block isn't part of the structure, so it can't hold one");
          }
        }

        if (body.placement === "sibling") {
          parentId = ref.parentId;
          afterId = ref.id;
        } else if (body.placement === "sibling-before") {
          parentId = ref.parentId;
          // Whatever currently precedes the reference, or the head of the list.
          const siblings = await siblingsOf(tx as unknown as typeof db, workId, ref.parentId);
          const at = siblings.findIndex((sib) => sib.id === ref.id);
          afterId = at > 0 ? (siblings[at - 1]?.id ?? null) : null;
          if (at === 0) {
            // Nothing before it: take a key ahead of the current first.
            const first = siblings[0];
            const sortKey = generateKeyBetween(null, first?.sortKey ?? null);
            const [row] = await tx
              .insert(blocks)
              .values({
                workId,
                parentId: ref.parentId,
                sortKey,
                label: body.label ?? null,
                formatId: body.formatId,
                content: null,
                contentText: "",
                wordCount: 0,
              })
              .returning();
            return row;
          }
        } else if (body.placement === "child") {
          parentId = ref.id;
          afterId = null;
        } else {
          // 'parent': one level shallower, immediately after the reference's parent.
          if (!ref.parentId) throw badRequest("that block is already at the top level");
          const [refParent] = await tx
            .select({ id: blocks.id, parentId: blocks.parentId })
            .from(blocks)
            .where(eq(blocks.id, ref.parentId))
            .limit(1);
          if (!refParent) throw notFound("parent block");
          parentId = refParent.parentId;
          afterId = refParent.id;
        }
      }

      const siblings = await siblingsOf(tx as unknown as typeof db, workId, parentId);
      const sortKey = keyAfter(siblings, afterId);

      const [row] = await tx
        .insert(blocks)
        .values({
          workId,
          parentId,
          sortKey,
          label: body.label ?? null,
          formatId: body.formatId,
          content: null,
          contentText: "",
          wordCount: 0,
        })
        .returning();
      return row;
    });

    if (!created) throw badRequest("could not create the block");
    reply.status(201);
    return { block: created };
  });

  app.patch("/blocks/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        label: z.string().max(500).nullable().optional(),
        formatId: z.string().uuid().optional(),
        content: z.record(z.unknown()).nullable().optional(),
      })
      .parse(req.body);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.label !== undefined) patch.label = body.label;
    if (body.formatId !== undefined) patch.formatId = body.formatId;
    if (body.content !== undefined) {
      // Word count is derived here rather than trusted from the client, so the
      // stored number and the manuscript total can't drift.
      const text = body.content ? extractText(body.content) : "";
      patch.content = body.content;
      patch.contentText = text;
      patch.wordCount = countWords(text);
    }

    const [updated] = await db.update(blocks).set(patch).where(eq(blocks.id, id)).returning();
    if (!updated) throw notFound("block");
    return { block: updated };
  });

  /**
   * Move a block. The break rendered before it is derived from its depth, so a
   * move to a different indentation changes the manuscript's punctuation without
   * this endpoint knowing anything about breaks.
   */
  app.post("/blocks/:id/move", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        parentId: z.string().uuid().nullable(),
        afterId: z.string().uuid().nullable().default(null),
      })
      .parse(req.body);

    const moved = await db.transaction(async (tx) => {
      const [block] = await tx
        .select({ id: blocks.id, workId: blocks.workId })
        .from(blocks)
        .where(eq(blocks.id, id))
        .limit(1);
      if (!block) throw notFound("block");

      if (body.parentId) {
        const all = await tx
          .select({ id: blocks.id, parentId: blocks.parentId })
          .from(blocks)
          .where(eq(blocks.workId, block.workId));
        // Dropping a block inside its own subtree would orphan the whole branch
        // from the root, and buildOutline would silently reparent it.
        if (body.parentId === id || descendantsOf(all, id).includes(body.parentId)) {
          throw badRequest("a block can't be moved inside itself");
        }
      }

      const siblings = (await siblingsOf(tx as unknown as typeof db, block.workId, body.parentId))
        .filter((s) => s.id !== id);
      const sortKey = keyAfter(siblings, body.afterId);

      const [row] = await tx
        .update(blocks)
        .set({ parentId: body.parentId, sortKey, updatedAt: new Date() })
        .where(eq(blocks.id, id))
        .returning();
      return row;
    });

    if (!moved) throw notFound("block");
    return { block: moved };
  });

  /**
   * Copy the break the block currently renders into the block itself, so it can
   * be edited on its own. Until this happens the break follows the level, which
   * is what lets a drag between indentations change it.
   */
  app.post("/blocks/:id/break/detach", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const detached = await db.transaction(async (tx) => {
      const [block] = await tx
        .select({ id: blocks.id, workId: blocks.workId, parentId: blocks.parentId, breakBody: blocks.breakBody })
        .from(blocks)
        .where(eq(blocks.id, id))
        .limit(1);
      if (!block) throw notFound("block");
      if (block.breakBody) throw badRequest("that break is already detached");

      // Depth is the block's distance from the root, and the level bound to that
      // depth is what the break currently comes from.
      const all = await tx
        .select({ id: blocks.id, parentId: blocks.parentId })
        .from(blocks)
        .where(eq(blocks.workId, block.workId));
      const parentOf = new Map(all.map((b) => [b.id, b.parentId]));
      let depth = 0;
      let cursor = block.parentId;
      const guard = new Set<string>();
      while (cursor && !guard.has(cursor)) {
        guard.add(cursor);
        depth += 1;
        cursor = parentOf.get(cursor) ?? null;
      }

      const [level] = await tx
        .select({ breakTemplateId: workLevels.breakTemplateId })
        .from(workLevels)
        .where(and(eq(workLevels.workId, block.workId), eq(workLevels.depth, depth)))
        .limit(1);
      if (!level?.breakTemplateId) throw badRequest("this block's level has no break to edit");

      const [template] = await tx
        .select({ id: templates.id, body: templates.body })
        .from(templates)
        .where(eq(templates.id, level.breakTemplateId))
        .limit(1);
      if (!template) throw notFound("break template");

      const [row] = await tx
        .update(blocks)
        .set({ breakTemplateId: template.id, breakBody: template.body, updatedAt: new Date() })
        .where(eq(blocks.id, id))
        .returning();
      return row;
    });

    if (!detached) throw notFound("block");
    return { block: detached };
  });

  /** Edit a detached break's body. */
  app.patch("/blocks/:id/break", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ body: z.object({ nodes: z.array(z.unknown()) }) }).parse(req.body);

    const [current] = await db
      .select({ breakBody: blocks.breakBody })
      .from(blocks)
      .where(eq(blocks.id, id))
      .limit(1);
    if (!current) throw notFound("block");
    if (!current.breakBody) throw badRequest("detach this break before editing it");

    const [updated] = await db
      .update(blocks)
      .set({ breakBody: body.body as never, updatedAt: new Date() })
      .where(eq(blocks.id, id))
      .returning();
    return { block: updated };
  });

  /** Discard the instance and follow the level's template again. */
  app.delete("/blocks/:id/break", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [updated] = await db
      .update(blocks)
      .set({ breakTemplateId: null, breakBody: null, updatedAt: new Date() })
      .where(eq(blocks.id, id))
      .returning();
    if (!updated) throw notFound("block");
    return { block: updated };
  });

  /**
   * Copy the block's format body onto the block so it can be edited alone.
   * Until this happens the block follows its template, and editing that
   * template reaches every block using it.
   */
  app.post("/blocks/:id/format/detach", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const [block] = await db
      .select({
        id: blocks.id,
        formatId: blocks.formatId,
        formatBody: blocks.formatBody,
        formatTypography: blocks.formatTypography,
      })
      .from(blocks)
      .where(eq(blocks.id, id))
      .limit(1);
    if (!block) throw notFound("block");
    if (block.formatBody || block.formatTypography) {
      throw badRequest("that format is already detached");
    }

    const [template] = await db
      .select({ body: templates.body, formatSettings: templates.formatSettings })
      .from(templates)
      .where(eq(templates.id, block.formatId))
      .limit(1);
    if (!template) throw notFound("format template");

    // A body of just the content slot has no arrangement to detach — for that
    // format, "its own" means its own type.
    const nodes = template.body?.nodes ?? [];
    const styleOnly = nodes.length === 1 && (nodes[0] as { type?: string })?.type === "content";

    const [row] = await db
      .update(blocks)
      .set({
        ...(styleOnly
          ? { formatTypography: template.formatSettings?.typography ?? {} }
          : { formatBody: template.body }),
        updatedAt: new Date(),
      })
      .where(eq(blocks.id, id))
      .returning();
    return { block: row };
  });

  app.patch("/blocks/:id/format", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        body: z.object({ nodes: z.array(z.unknown()) }).optional(),
        typography: z.record(z.unknown()).nullable().optional(),
      })
      .parse(req.body);

    const [current] = await db
      .select({ formatBody: blocks.formatBody, formatTypography: blocks.formatTypography })
      .from(blocks)
      .where(eq(blocks.id, id))
      .limit(1);
    if (!current) throw notFound("block");
    if (!current.formatBody && !current.formatTypography) {
      throw badRequest("detach this format before editing it");
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.body !== undefined) patch.formatBody = body.body;
    if (body.typography !== undefined) patch.formatTypography = body.typography;

    const [row] = await db.update(blocks).set(patch).where(eq(blocks.id, id)).returning();
    return { block: row };
  });

  app.delete("/blocks/:id/format", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const [row] = await db
      .update(blocks)
      .set({ formatBody: null, formatTypography: null, updatedAt: new Date() })
      .where(eq(blocks.id, id))
      .returning();
    if (!row) throw notFound("block");
    return { block: row };
  });

  app.delete("/blocks/:id", async (req) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    // parent_id cascades in the schema, so the subtree goes with it.
    const [deleted] = await db.delete(blocks).where(eq(blocks.id, id)).returning({ id: blocks.id });
    if (!deleted) throw notFound("block");
    return { ok: true };
  });

  app.get("/templates", async (req) => {
    requireUser(req);
    const rows = await db.select().from(templates).orderBy(asc(templates.category), asc(templates.name));
    return { templates: rows };
  });

  /** Recount every block in a work. Cheap insurance while the editor is young. */
  app.post("/works/:workId/recount", async (req) => {
    requireUser(req);
    const { workId } = z.object({ workId: z.string().uuid() }).parse(req.params);
    await db.execute(sql`
      UPDATE blocks
      SET word_count = COALESCE(array_length(regexp_split_to_array(btrim(content_text), '\\s+'), 1), 0)
      WHERE work_id = ${workId} AND btrim(content_text) <> ''
    `);
    await db.execute(sql`
      UPDATE blocks SET word_count = 0 WHERE work_id = ${workId} AND btrim(content_text) = ''
    `);
    return { ok: true };
  });
}
