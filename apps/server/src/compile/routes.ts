import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { blocks, templates, workLevels, works } from "@brigid/db";
import { authenticate, requireUser } from "../auth/middleware.js";
import { db } from "../db.js";
import { notFound } from "../lib/errors.js";
import { compileManuscript } from "./plan.js";

/**
 * What lands in someone's downloads: Lastname_Shortitle_Manuscript.docx.
 *
 * The name an editor will see on a submission, so it carries no spaces and
 * nothing that needs quoting in a shell or an email client.
 */
function fileNameFor(surname: string, shortTitle: string, extension: string): string {
  const word = (value: string, fallback: string) =>
    value
      .normalize("NFKD")
      .replace(/[^\w]/g, "")
      .slice(0, 40) || fallback;

  const family = word(surname, "Author");
  const short = word(shortTitle, "Manuscript");
  return `${family}_${short}_Manuscript.${extension}`;
}

export async function compileRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", authenticate);

  app.post("/works/:id/compile", async (req, reply) => {
    requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        format: z.enum(["docx", "pdf"]),
        /** Block ids to include. Everything, when absent or empty. */
        include: z.array(z.string().uuid()).optional(),
        runningHeads: z.boolean().default(true),
        // One word. It is the running head and half the filename, and both are
        // read at a glance.
        shortTitle: z
          .string()
          .trim()
          .min(1, "a short title is needed")
          .max(40)
          .refine((v) => !/\s/.test(v), "the short title should be a single word"),
      })
      .parse(req.body);

    const [work] = await db.select().from(works).where(eq(works.id, id)).limit(1);
    if (!work) throw notFound("work");

    const [rows, levels, formats] = await Promise.all([
      db.select().from(blocks).where(eq(blocks.workId, id)).orderBy(asc(blocks.sortKey)),
      db.select().from(workLevels).where(eq(workLevels.workId, id)).orderBy(asc(workLevels.depth)),
      db.select().from(templates),
    ]);

    const structural = new Map(
      formats.map((t) => [t.id, t.formatSettings?.structural ?? true] as const),
    );

    const manuscript = compileManuscript(
      {
        blocks: rows,
        levels,
        templates: formats,
        work: {
          title: work.title,
          subtitle: work.subtitle,
          authorFirstName: work.authorFirstName,
          authorLastName: work.authorLastName,
        },
        prose: new Map(
          rows.map((b) => [b.id, { content: b.content, contentText: b.contentText }]),
        ),
        structural: (formatId) => structural.get(formatId) ?? true,
      },
      {
        ...(body.include ? { include: body.include } : {}),
        runningHeads: body.runningHeads,
        shortTitle: body.shortTitle,
      },
    );

    /**
      * Loaded when asked for, not at boot.
      *
      * These two pull in a Word writer and a PDF engine, and a PDF engine
      * carries a font library behind it. None of that has any business being
      * between the server and its first request: if one of them cannot load on
      * a given machine, the answer should be that compiling to that format
      * failed, not that Brigid is down.
      */
    const file =
      body.format === "docx"
        ? await (await import("./docx.js")).toDocx(manuscript)
        : await (await import("./pdf.js")).toPdf(manuscript);

    reply.header(
      "Content-Type",
      body.format === "docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/pdf",
    );
    reply.header(
      "Content-Disposition",
      `attachment; filename="${fileNameFor(
        work.authorLastName ?? work.authorFirstName ?? "",
        body.shortTitle,
        body.format,
      )}"`,
    );
    return reply.send(file);
  });
}
