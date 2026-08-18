import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { extractText } from "../src/blocks/text.js";
import { hashContent, hashProse } from "../src/ollama/digest.js";

/**
 * Why the reading says what it says.
 *
 * "0 of 83" is the same message for a manuscript nobody has read, one whose
 * prose has moved, and one whose model has been swapped — and the progress bar
 * cannot tell them apart, so neither can anyone watching it. This asks the
 * database the same question the walk asks, section by section, and says which
 * answer came back.
 *
 * Read-only. It changes nothing and recommends rather than acts.
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
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const [settings] = await sql<{ model: string | null; url: string | null }[]>`
    SELECT inference_model AS model, ollama_url AS url FROM settings LIMIT 1`;

  const rows = await sql<
    {
      id: string;
      work_id: string;
      content: unknown;
      content_text: string;
      counts: { countsTowardWordCount?: boolean } | null;
      hash: string | null;
      model: string | null;
    }[]
  >`
    SELECT b.id, b.work_id, b.content, b.content_text,
           t.format_settings AS counts,
           d.content_hash AS hash, d.model
    FROM blocks b
    JOIN templates t ON t.id = b.format_id
    LEFT JOIN section_digests d ON d.block_id = b.id`;

  // Exactly the walk's own filter.
  const sections = rows.filter(
    (r) => r.counts?.countsTowardWordCount !== false && r.content_text.trim().length > 0,
  );

  const tally = {
    current: 0,
    neverRead: 0,
    otherModel: 0,
    oldHashStyle: 0,
    textMoved: 0,
    textStale: 0,
  };
  const models = new Set<string>();

  for (const r of sections) {
    if (r.model) models.add(r.model);
    if (!r.hash) {
      tally.neverRead += 1;
      continue;
    }
    const wanted = hashProse(r.content_text);
    const modelOk = r.model === settings?.model;

    if (r.hash === wanted && modelOk) tally.current += 1;
    else if (r.hash === wanted) tally.otherModel += 1;
    else if (r.hash === hashContent(r.content_text)) tally.oldHashStyle += 1;
    else if (extractText(r.content) !== r.content_text) tally.textStale += 1;
    else tally.textMoved += 1;
  }

  const say = (n: number, what: string) => {
    if (n > 0) console.log(`  ${String(n).padStart(4)}  ${what}`);
  };

  console.log(`\n${sections.length} sections count toward the reading.\n`);
  say(tally.current, "read, and current — these are what the walk calls done");
  say(tally.neverRead, "never read");
  say(tally.otherModel, "read by a different model than the one connected");
  say(tally.oldHashStyle, "read, but stamped in the old hash style — `pnpm backfill:text` repairs these");
  say(tally.textStale, "stored text is out of date — `pnpm backfill:text` repairs these");
  say(tally.textMoved, "genuinely edited since they were read");

  console.log(`\nconnected model:  ${settings?.model ?? "(none set)"}`);
  console.log(`digests written by: ${[...models].join(", ") || "(nothing read yet)"}`);

  if (tally.otherModel > 0) {
    console.log(
      `\nThe reading will start from zero, and no repair avoids it: a digest is only\n` +
        `current for the model that wrote it. Either re-read once under the connected\n` +
        `model, or point the settings back at the model that wrote these.`,
    );
  }
} finally {
  await sql.end();
}
