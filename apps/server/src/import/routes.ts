import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { DEFAULT_PAGE_SETUP, countWords, planImport } from "@brigid/shared";
import type { TemplateBody } from "@brigid/shared";
import { blocks, templates, workLevels, works } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { badRequest } from "../lib/errors.js";
import { extractDocxParagraphs } from "./docx.js";

const paragraphSchema = z.object({
  text: z.string(),
  pageBreakBefore: z.boolean().optional(),
});

const markerSchema = z.object({
  depth: z.number().int().min(0).max(11),
  name: z.string().min(1).max(120),
  prefix: z.string().min(1).max(200),
  keepLine: z.boolean().optional(),
  breakTemplateId: z.string().uuid().nullable(),
  counterRestart: z.enum(["continuous", "under-parent"]).default("continuous"),
});

/** A ProseMirror doc of plain paragraphs — what an import produces. */
function proseDoc(paragraphs: readonly string[]) {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : [],
    })),
  };
}

export async function importRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  /**
   * Read a .docx and hand back its paragraphs. The client keeps them while the
   * writer sets markers and previews the result, then posts them back — which
   * avoids parking an uploaded file on the server between two requests.
   */
  app.post("/import/analyze", async (req) => {
    requireUser(req);
    const file = await req.file();
    if (!file) throw badRequest("no file uploaded");
    if (!/\.docx$/i.test(file.filename)) {
      throw badRequest("only .docx files can be imported — save the document as Word format first");
    }

    const buffer = await file.toBuffer();
    const paragraphs = extractDocxParagraphs(new Uint8Array(buffer));
    return {
      filename: file.filename,
      paragraphs,
      hasPageBreaks: paragraphs.some((p) => p.pageBreakBefore),
    };
  });

  app.post("/import/create", async (req, reply) => {
    requireUser(req);
    const body = z
      .object({
        title: z.string().min(1).max(500),
        subtitle: z.string().max(500).nullable().optional(),
        authorFirstName: z.string().max(200).nullable().optional(),
        authorLastName: z.string().max(200).nullable().optional(),
        paragraphs: z.array(paragraphSchema).min(1).max(100_000),
        markers: z.array(markerSchema).min(1).max(12),
        firstPageIsTitlePage: z.boolean(),
      })
      .parse(req.body);

    const plan = planImport({
      paragraphs: body.paragraphs,
      markers: body.markers,
      firstPageIsTitlePage: body.firstPageIsTitlePage,
    });

    const [regular] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.builtinKey, "regular-text"))
      .limit(1);
    if (!regular) throw badRequest("the built-in Regular text format is missing");

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

      // Levels come from the markers, so the outline mirrors the structure the
      // writer just described rather than a default that ignores it.
      const byDepth = new Map<number, (typeof body.markers)[number]>();
      for (const marker of body.markers) if (!byDepth.has(marker.depth)) byDepth.set(marker.depth, marker);
      const depths = [...byDepth.keys()].sort((a, b) => a - b);
      await tx.insert(workLevels).values(
        depths.map((depth, i) => {
          const marker = byDepth.get(depth);
          return {
            workId: work.id,
            depth: i,
            name: marker?.name ?? `Level ${i + 1}`,
            breakTemplateId: marker?.breakTemplateId ?? null,
            counterRestart: marker?.counterRestart ?? "continuous",
          };
        }),
      );
      // Marker depths may be sparse; map them onto the compacted level indexes.
      const depthIndex = new Map(depths.map((d, i) => [d, i]));

      /**
       * The title page is reproduced word for word, so it becomes a format
       * template of its own holding those exact lines — no variables, nothing
       * inferred. It belongs to this work alone, hence the name.
       */
      let titleFormatId: string | null = null;
      if (plan.titlePage && plan.titlePage.length > 0) {
        const titleBody: TemplateBody = {
          nodes: [
            ...plan.titlePage.map((line) => ({
              type: "paragraph" as const,
              align: "center" as const,
              content: [{ type: "text" as const, text: line }],
            })),
            { type: "pageBreak" as const },
          ],
        };
        const [titleFormat] = await tx
          .insert(templates)
          .values({
            category: "block-format",
            name: `Title page — ${body.title}`,
            body: titleBody,
            formatSettings: {
              countsTowardWordCount: false,
              structural: false,
              rendersInDocument: true,
            },
          })
          .returning({ id: templates.id });
        titleFormatId = titleFormat?.id ?? null;
      }

      // Sort keys are generated per parent as the tree is walked.
      const lastKeyByParent = new Map<string | null, string>();
      const nextKey = (parentId: string | null) => {
        const key = generateKeyBetween(lastKeyByParent.get(parentId) ?? null, null);
        lastKeyByParent.set(parentId, key);
        return key;
      };

      if (titleFormatId) {
        await tx.insert(blocks).values({
          workId: work.id,
          parentId: null,
          sortKey: nextKey(null),
          label: "Title page",
          formatId: titleFormatId,
          content: null,
          contentText: "",
          wordCount: 0,
        });
      }

      // The most recent block at each depth, so a deeper block knows its parent.
      const openAt = new Map<number, string>();
      for (const planned of plan.blocks) {
        const depth = depthIndex.get(planned.depth) ?? 0;
        let parentId: string | null = null;
        for (let d = depth - 1; d >= 0; d -= 1) {
          const candidate = openAt.get(d);
          if (candidate) {
            parentId = candidate;
            break;
          }
        }

        const text = planned.paragraphs.join("\n\n");
        const [row] = await tx
          .insert(blocks)
          .values({
            workId: work.id,
            parentId,
            sortKey: nextKey(parentId),
            label: planned.label,
            formatId: regular.id,
            content: planned.paragraphs.length ? proseDoc(planned.paragraphs) : null,
            contentText: text,
            wordCount: countWords(text),
          })
          .returning({ id: blocks.id });

        if (row) {
          openAt.set(depth, row.id);
          // A new block at this depth closes anything deeper.
          for (const d of [...openAt.keys()]) if (d > depth) openAt.delete(d);
        }
      }

      return work;
    });

    reply.status(201);
    return { work: created, matches: plan.matches, blockCount: plan.blocks.length };
  });
}
