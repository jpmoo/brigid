import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { extractText } from "../src/blocks/text.js";
import { hashContent, hashProse } from "../src/ollama/digest.js";

/**
 * Re-derive every block's stored plain text from the document it came from.
 *
 * content_text is derived from content, and was derived with block-level nodes
 * joined by a single space — so it held no blank lines, and everything that
 * splits paragraphs on one found exactly a single paragraph per section.
 * Paragraph length reported section length, the reading walk was sent unbroken
 * text, and the passages shown to the model as the writer's own prose arrived
 * with their paragraphing removed.
 *
 * The derivation is fixed, but it only runs when a block is saved, so rows
 * written before that fix keep the old text until each one is edited by hand.
 * Nothing was lost: content is the document itself and content_text has always
 * been a convenience derived from it.
 *
 * In TypeScript rather than as a SQL migration on purpose. The alternative was
 * a recursive PL/pgSQL walk over the same JSON — a second implementation of
 * extractText, in a language it does not share, that could not be tested here
 * and would be free to drift from the real one for ever. This calls the actual
 * function, the one the test suite covers.
 *
 * Only rows whose text genuinely changes are written, so running it twice costs
 * a read and nothing else.
 *
 * Word counts are left alone. They were computed from the same text and do not
 * turn on which whitespace separates a paragraph.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
config({ path: join(repoRoot, ".env") });
config({ path: join(repoRoot, ".env.local"), override: true });

function fromConfigFile(): string | undefined {
  const path = process.env.BRIGID_CONFIG_PATH ?? join(repoRoot, "data", "brigid.config.json");
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { databaseUrl?: string }).databaseUrl;
  } catch {
    return undefined;
  }
}

const url = process.env.DATABASE_URL?.trim() || fromConfigFile();
if (!url) {
  console.error("DATABASE_URL is required — set it in .env.local, or run this after first-run setup");
  process.exit(1);
}

const dry = process.argv.includes("--dry-run");
const sql = postgres(url, { max: 1 });

try {
  const rows = await sql<{ id: string; content: unknown; content_text: string }[]>`
    SELECT id, content, content_text FROM blocks WHERE content IS NOT NULL`;

  /**
   * Heal any digest whose hash is current under either rule.
   *
   * Run before the server was restarted, this tool re-points hashes that the
   * still-running old build then overwrites in its own style as it re-reads —
   * so the walk comes back up seeing nothing it recognizes and starts from
   * zero. The same thing happens to anything read between the two commands.
   *
   * Both spellings mean the same fact: a digest whose stored hash matches the
   * current text under the exact rule, or under the whitespace-insensitive one,
   * was written from this prose and is an accurate account of it. Either is
   * repointed to the rule the walk now uses. A hash matching neither is genuinely
   * behind — real editing this cannot vouch for — and is left alone.
   *
   * Which makes running this twice, or in the wrong order, a repair rather than
   * a problem.
   */
  const heal = async (id: string, text: string): Promise<number> => {
    const exact = hashContent(text);
    const loose = hashProse(text);
    const done = await sql`
      UPDATE section_digests
      SET content_hash = ${loose}
      WHERE block_id = ${id}
        AND content_hash <> ${loose}
        AND content_hash IN (${exact}, ${loose})`;
    return done.count;
  };

  let changed = 0;
  let paragraphsGained = 0;
  let carried = 0;

  for (const row of rows) {
    const next = extractText(row.content);
    if (next === row.content_text) continue;
    changed += 1;
    const before = row.content_text.split(/\n[ \t]*\n/).filter((p) => p.trim()).length;
    const after = next.split(/\n[ \t]*\n/).filter((p) => p.trim()).length;
    paragraphsGained += Math.max(0, after - before);
    if (dry) continue;

    await sql`UPDATE blocks SET content_text = ${next} WHERE id = ${row.id}`;

    /**
     * Carry a current digest across rather than making the walk earn it again.
     *
     * The prose is the same prose — only the whitespace between its paragraphs
     * moved — so a digest that was current for the old text is still an
     * accurate account of what happens in the new one. Re-pointing its hash
     * saves re-reading the whole manuscript to arrive back where we started.
     *
     * Only where the digest was actually current. One that had already fallen
     * behind stays behind, because that is a real edit this cannot speak for.
     */
    // Against the text as it stood, for a digest the old build wrote.
    const done = await sql`
      UPDATE section_digests
      SET content_hash = ${hashProse(next)}
      WHERE block_id = ${row.id} AND content_hash = ${hashContent(row.content_text)}`;
    carried += done.count;
  }

  // And again over everything, against the text as it now stands — which
  // catches whatever was read between the rewrite and the restart.
  if (!dry) {
    for (const row of rows) {
      carried += await heal(row.id, extractText(row.content));
    }
  }

  /**
   * What the walk will make of it, before anyone waits on a progress bar.
   *
   * A digest counts as current only if its model matches the one now
   * configured as well as its hash, so a manuscript can read as entirely
   * unread for a reason that has nothing to do with this tool.
   */
  const [state] = await sql<{ current: number; total: number; models: string[] }[]>`
    SELECT
      count(*) FILTER (WHERE d.content_hash IS NOT NULL) AS current,
      (SELECT count(*) FROM blocks WHERE content IS NOT NULL) AS total,
      coalesce(array_agg(DISTINCT d.model), '{}') AS models
    FROM section_digests d`;
  const [settings] = await sql<{ model: string | null }[]>`
    SELECT inference_model AS model FROM settings LIMIT 1`;
  const stale = state && settings?.model && !state.models.includes(settings.model);

  console.log(
    `${rows.length} blocks read, ${changed} ${dry ? "would change" : "rewritten"}, ` +
      `${paragraphsGained.toLocaleString()} paragraphs recovered` +
      (dry ? "" : `, ${carried} digests carried over`),
  );
  if (!dry && stale) {
    console.log(
      `\nThe reading will still start from zero, and not because of this. The\n` +
        `digests were written by ${state.models.join(", ") || "no model"} and the\n` +
        `connected model is now ${settings?.model}. A digest is only current for the\n` +
        `model that wrote it, so changing models re-reads the manuscript.`,
    );
  } else if (changed > 0 && !dry) {
    console.log(
      "\nProseDNA re-measures on its own the next time it is opened — nothing there\n" +
        "needs re-running, and the paragraph figures will be right.\n\n" +
        "The reading is left alone. Those digests describe the same prose and are\n" +
        "still accurate, so chat and the analyses keep working. They were written\n" +
        "from text with its paragraph breaks removed, though, so a fresh reading\n" +
        "would be a better one — 'Start over' under the reading state, when an hour\n" +
        "of the machine is convenient.",
    );
  }
} finally {
  await sql.end();
}
