import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { extractText } from "../src/blocks/text.js";

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

  let changed = 0;
  let paragraphsGained = 0;

  for (const row of rows) {
    const next = extractText(row.content);
    if (next === row.content_text) continue;
    changed += 1;
    const before = row.content_text.split(/\n[ \t]*\n/).filter((p) => p.trim()).length;
    const after = next.split(/\n[ \t]*\n/).filter((p) => p.trim()).length;
    paragraphsGained += Math.max(0, after - before);
    if (!dry) {
      await sql`UPDATE blocks SET content_text = ${next} WHERE id = ${row.id}`;
    }
  }

  console.log(
    `${rows.length} blocks read, ${changed} ${dry ? "would change" : "rewritten"}, ` +
      `${paragraphsGained.toLocaleString()} paragraphs recovered`,
  );
  if (changed > 0 && !dry) {
    console.log(
      "\nThe next reading walk will re-read what changed — the digests were built\n" +
        "from text with its paragraph structure removed. ProseDNA re-measures on its\n" +
        "own the next time it is opened; nothing there needs re-running.",
    );
  }
} finally {
  await sql.end();
}
