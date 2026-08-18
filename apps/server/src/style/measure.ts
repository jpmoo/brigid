import { and, eq, inArray, sql } from "drizzle-orm";
import { blocks, styleFeatures, templates } from "@brigid/db";
import { buildOutline, measure } from "@brigid/shared";
import type { StyleSample } from "@brigid/shared";
import { db } from "../db.js";
import { hashContent } from "../ollama/digest.js";

/**
 * Keeping the fingerprint up with the manuscript.
 *
 * The digest's mechanism exactly, minus the model: every section carries a hash
 * of the prose it was measured from, and a section whose hash no longer matches
 * is measured again. Nothing has to remember to invalidate anything.
 *
 * Unlike the digest this costs nothing worth budgeting — a section is a few
 * milliseconds of arithmetic — so it does not need a queue, a worker loop or a
 * progress bar. It runs when the manuscript is asked about, walks whatever has
 * changed, and returns. A book with no model connected still has a
 * fingerprint, which is the point of measuring rather than judging.
 */

/** What the upsert should take from the row being inserted. */
const incoming = (column: string) => sql.raw(`excluded.${column}`);

/** Sections that reach the page. A title page has no prose style. */
async function proseBlocks(workId: string) {
  const rows = await db
    .select({
      id: blocks.id,
      parentId: blocks.parentId,
      sortKey: blocks.sortKey,
      contentText: blocks.contentText,
      styleExcluded: blocks.styleExcluded,
      styleVoice: blocks.styleVoice,
      structural: templates.formatSettings,
    })
    .from(blocks)
    .innerJoin(templates, eq(templates.id, blocks.formatId))
    .where(eq(blocks.workId, workId));

  /**
   * In the order they are read, which is the only order that means anything to
   * the person choosing what counts. A query returns rows in whatever order
   * the database finds convenient, so the list arrived shuffled — chapter
   * eleven above chapter two — and there was no way to tell from looking at it
   * that it was not deliberate.
   */
  const order = new Map(
    buildOutline(
      // Only what the walk needs to order them; the rest is this query's.
      rows.map((r) => ({
        id: r.id,
        parentId: r.parentId,
        sortKey: r.sortKey,
        label: null,
        formatId: "",
        wordCount: 0,
      })),
    ).map((entry, at) => [entry.block.id, at] as const),
  );

  return rows
    .filter((r) => r.structural?.structural !== false)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * Measure whatever has changed, and return every section's numbers.
 *
 * Both at once because they are the same walk: the caller wants the current
 * picture, and the current picture is exactly what re-measuring produces.
 */
export async function refresh(workId: string): Promise<StyleSample[]> {
  const sections = await proseBlocks(workId);
  if (sections.length === 0) return [];

  const stored = await db
    .select()
    .from(styleFeatures)
    .where(eq(styleFeatures.workId, workId));
  const held = new Map(stored.map((r) => [r.blockId, r]));

  const samples: StyleSample[] = [];
  const writes: (typeof styleFeatures.$inferInsert)[] = [];

  for (const section of sections) {
    const text = section.contentText ?? "";
    const hash = hashContent(text);
    const row = held.get(section.id);

    if (row && row.contentHash === hash) {
      samples.push({
        blockId: section.id,
        voice: section.styleVoice,
        included: !section.styleExcluded,
        measurement: {
          words: row.words,
          sentences: row.sentences,
          paragraphs: row.paragraphs,
          dialogueShare: row.dialogueShare,
          overall: row.overall,
          narration: row.narration,
          dialogue: row.dialogue,
        },
      });
      continue;
    }

    const m = measure(text);
    writes.push({
      blockId: section.id,
      workId,
      contentHash: hash,
      words: m.words,
      sentences: m.sentences,
      paragraphs: m.paragraphs,
      dialogueShare: m.dialogueShare,
      overall: m.overall,
      narration: m.narration,
      dialogue: m.dialogue,
      measuredAt: new Date(),
    });
    samples.push({
      blockId: section.id,
      voice: section.styleVoice,
      included: !section.styleExcluded,
      measurement: m,
    });
  }

  if (writes.length > 0) {
    // In chunks: a manuscript measured from cold is every section at once, and
    // Postgres has a limit on parameters per statement that a long novel with
    // two hundred features a row would otherwise walk into.
    for (let i = 0; i < writes.length; i += 100) {
      await db
        .insert(styleFeatures)
        .values(writes.slice(i, i + 100))
        .onConflictDoUpdate({
          target: styleFeatures.blockId,
          set: {
            contentHash: incoming("content_hash"),
            words: incoming("words"),
            sentences: incoming("sentences"),
            paragraphs: incoming("paragraphs"),
            dialogueShare: incoming("dialogue_share"),
            overall: incoming("overall"),
            narration: incoming("narration"),
            dialogue: incoming("dialogue"),
            measuredAt: new Date(),
          },
        });
    }
  }

  // Rows for sections that no longer exist go with the block, by cascade. Rows
  // for blocks that stopped being structural — a section reformatted as front
  // matter — do not, so they are cleared here.
  const alive = new Set(sections.map((s) => s.id));
  const orphaned = stored.filter((r) => !alive.has(r.blockId)).map((r) => r.blockId);
  if (orphaned.length > 0) {
    await db
      .delete(styleFeatures)
      .where(and(eq(styleFeatures.workId, workId), inArray(styleFeatures.blockId, orphaned)));
  }

  return samples;
}

