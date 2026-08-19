import { sql } from "drizzle-orm";
import { writingActivity } from "@brigid/db";
import { db } from "../db.js";

/**
 * What changed between two versions of a section, in words.
 *
 * A word count can only ever report the difference, and the difference is the
 * least interesting number: a morning spent writing four hundred words and
 * cutting three hundred and ninety is not a morning spent writing ten. Both
 * directions have to be measured separately or the graph can only ever draw one
 * bar.
 *
 * Compared as multisets rather than by finding a true edit script. A word-level
 * diff of two five-thousand-word sections on every autosave is not something to
 * put in a save path, and the cheap answer is arguably the more honest one:
 * moving a paragraph is not writing, and this counts it as neither added nor
 * deleted. Rewriting a sentence counts as both, which is exactly what it is.
 */
export function wordDelta(before: string, after: string): { added: number; deleted: number } {
  const tally = (text: string) => {
    const counts = new Map<string, number>();
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
    return counts;
  };

  const was = tally(before);
  const now = tally(after);
  let added = 0;
  let deleted = 0;

  for (const [word, count] of now) added += Math.max(0, count - (was.get(word) ?? 0));
  for (const [word, count] of was) deleted += Math.max(0, count - (now.get(word) ?? 0));

  return { added, deleted };
}

/**
 * Fold a change into the minute it happened in.
 *
 * A row per save would be a table of noise — the editor saves while the writer
 * is still typing — so saves land in a bucket and add to it. A minute is the
 * finest thing anyone asks about, because the shortest question is "how did
 * this sitting go".
 *
 * Never allowed to fail a save. Losing a minute of the graph is a small thing;
 * refusing to store the writer's prose because the bookkeeping failed is not.
 */
export async function recordChange(
  workId: string,
  before: string,
  after: string,
): Promise<void> {
  const { added, deleted } = wordDelta(before, after);
  if (added === 0 && deleted === 0) return;

  try {
    await db
      .insert(writingActivity)
      .values({ workId, minute: sql`date_trunc('minute', now())`, added, deleted })
      .onConflictDoUpdate({
        target: [writingActivity.workId, writingActivity.minute],
        set: {
          added: sql`${writingActivity.added} + ${added}`,
          deleted: sql`${writingActivity.deleted} + ${deleted}`,
        },
      });
  } catch {
    // Bookkeeping. It does not get to break writing.
  }
}
