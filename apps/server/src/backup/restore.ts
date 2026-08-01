import { sql } from "drizzle-orm";
import { closeDb, db, initDb } from "../db.js";
import { backupPath, run, takeBackup } from "./store.js";

/**
 * Putting a backup back.
 *
 * Both routes take a backup of the current state first, unprompted. A restore
 * is the one operation here that destroys something, and the writer asking for
 * it is not the same as the writer having meant the particular file they
 * picked. The safety copy is what makes the mistake recoverable.
 */

/**
 * The whole database, as it was.
 *
 * Connections are dropped first: `--clean` drops objects before recreating
 * them, and a pool holding a lock on a table is enough to make that fail
 * halfway, which is the worst possible place for it to stop.
 */
export async function restoreEverything(databaseUrl: string, name: string): Promise<string> {
  const safety = await takeBackup(databaseUrl, "before-restore");

  await closeDb();
  try {
    await run("pg_restore", [
      "--clean",
      // Without this, every DROP of something the backup expects but this
      // database hasn't got is an error rather than a no-op.
      "--if-exists",
      "--no-owner",
      "--no-acl",
      `--dbname=${databaseUrl}`,
      backupPath(name),
    ]);
  } finally {
    // Reconnected whatever happened: a half-restored database still has to be
    // reachable, or the writer cannot even get back in to try the safety copy.
    initDb(databaseUrl);
  }

  return safety.name;
}

/** The tables a manuscript lives in, in the order they can be written. */
const WORK_TABLES = ["works", "work_levels", "blocks", "bookmarks"] as const;
const STAGING = "brigid_restore";

/**
 * What to bring back, short of everything.
 *
 * Separate switches rather than one list, because they are separate decisions:
 * losing a manuscript is not a reason to also revert the formats, and reverting
 * the formats is not a reason to touch a manuscript.
 */
export interface RestoreParts {
  /** One manuscript, by id. */
  workId?: string | undefined;
  /** The instance settings row — Ollama, spelling, the backup schedule itself. */
  settings?: boolean | undefined;
  /** The words taught to the checker. */
  dictionary?: boolean | undefined;
  /** The format and break library. */
  templates?: boolean | undefined;
}

/**
 * One backup, put back in pieces.
 *
 * The dump holds the whole database, so whatever is wanted has to be separated
 * from the rest before anything is touched. It is loaded into a schema of its
 * own — which needs no privilege beyond owning the database, unlike the more
 * obvious approach of restoring into a scratch database — and copied across
 * from there inside a single transaction, so a failure part way leaves nothing
 * half-applied.
 *
 * pg_restore writes its data section as `COPY public.<table>`, so staging is a
 * matter of pointing those lines at the other schema. That is the only text
 * handling here, and it touches the COPY header alone; the data is never parsed.
 */
export async function restoreParts(
  databaseUrl: string,
  name: string,
  parts: RestoreParts,
): Promise<{ safety: string; restored: string[] }> {
  const wanted = new Set<string>();
  // Always staged: a manuscript's blocks point at formats, and the backup may
  // hold one this database no longer has.
  wanted.add("templates");
  if (parts.workId) for (const table of WORK_TABLES) wanted.add(table);
  if (parts.settings) wanted.add("settings");
  if (parts.dictionary) wanted.add("dictionary_words");

  if (wanted.size === 1 && !parts.templates) {
    throw new Error("nothing was chosen to restore");
  }

  const safety = (await takeBackup(databaseUrl, "before-restore")).name;
  const tables = [...wanted];

  const dumped = await run("pg_restore", [
    "--data-only",
    "--no-owner",
    "--no-acl",
    ...tables.map((t) => `--table=${t}`),
    "--file=-",
    backupPath(name),
  ]);

  const staged = dumped
    .split("\n")
    .filter((line) => !line.startsWith("SELECT pg_catalog.setval"))
    .map((line) =>
      line.startsWith("COPY public.") ? line.replace("COPY public.", `COPY ${STAGING}.`) : line,
    )
    .join("\n");

  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${STAGING} CASCADE`));
  await db.execute(sql.raw(`CREATE SCHEMA ${STAGING}`));
  for (const table of tables) {
    // Structure only — no keys, so the load cannot fail on whatever order the
    // dump happens to use, and none of it outlives this call anyway.
    await db.execute(
      sql.raw(`CREATE TABLE ${STAGING}.${table} (LIKE public.${table} INCLUDING DEFAULTS)`),
    );
  }

  const restored: string[] = [];
  try {
    await run("psql", ["--quiet", "--no-psqlrc", "--set=ON_ERROR_STOP=1", databaseUrl], {
      stdin: staged,
    });

    let title: string | null = null;
    if (parts.workId) {
      const rows = await db.execute<{ title: string }>(
        sql.raw(`SELECT title FROM ${STAGING}.works WHERE id = '${asUuid(parts.workId)}'`),
      );
      const found = Array.isArray(rows) ? rows[0] : undefined;
      if (!found) throw new Error("that manuscript is not in this backup");
      title = found.title;
    }

    await db.execute(sql.raw("BEGIN"));
    try {
      if (parts.templates) {
        // Asked for explicitly, so the backup's version wins over what is here.
        await db.execute(sql.raw(await upsert("templates")));
        restored.push("formats");
      }

      if (parts.settings) {
        await db.execute(sql.raw("DELETE FROM public.settings"));
        await db.execute(sql.raw(`INSERT INTO public.settings SELECT * FROM ${STAGING}.settings`));
        restored.push("settings");
      }

      if (parts.dictionary) {
        // Replaced rather than merged: restoring a dictionary means the one in
        // the backup, not that one plus whatever has accumulated since.
        await db.execute(sql.raw("DELETE FROM public.dictionary_words"));
        await db.execute(
          sql.raw(`INSERT INTO public.dictionary_words SELECT * FROM ${STAGING}.dictionary_words`),
        );
        restored.push("dictionary");
      }

      if (parts.workId) {
        const id = asUuid(parts.workId);
        // Formats it needs but this database hasn't got. Only the missing ones:
        // a format is shared, and quietly rewriting one to suit a single
        // manuscript would change every other manuscript using it. The
        // manuscript's own departures from a format are stored on its blocks,
        // so they come back with the blocks either way.
        if (!parts.templates) {
          await db.execute(
            sql.raw(
              `INSERT INTO public.templates SELECT * FROM ${STAGING}.templates
               ON CONFLICT (id) DO NOTHING`,
            ),
          );
        }

        // Replaced wholesale. Its children cascade, so removing it clears the
        // blocks and bookmarks of the version being discarded rather than
        // leaving them to collide with the ones coming in.
        await db.execute(sql.raw(`DELETE FROM public.works WHERE id = '${id}'`));
        for (const table of WORK_TABLES) {
          const column = table === "works" ? "id" : "work_id";
          await db.execute(
            sql.raw(
              `INSERT INTO public.${table}
               SELECT * FROM ${STAGING}.${table} WHERE ${column} = '${id}'`,
            ),
          );
        }
        restored.push(title ?? "manuscript");
      }

      await db.execute(sql.raw("COMMIT"));
    } catch (err) {
      await db.execute(sql.raw("ROLLBACK"));
      throw err;
    }

    return { safety, restored };
  } finally {
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${STAGING} CASCADE`));
  }
}

/**
 * An insert that overwrites what is already there.
 *
 * The column list is read from the database rather than written out here, so a
 * migration that adds a column doesn't quietly leave it behind on restore.
 */
async function upsert(table: string): Promise<string> {
  const rows = await db.execute<{ column_name: string }>(
    sql.raw(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = '${table}'
         AND column_name <> 'id'
       ORDER BY ordinal_position`,
    ),
  );
  const columns = (Array.isArray(rows) ? rows : []).map((r) => `"${r.column_name}"`);
  if (columns.length === 0) {
    return `INSERT INTO public.${table} SELECT * FROM ${STAGING}.${table}
            ON CONFLICT (id) DO NOTHING`;
  }
  const set =
    columns.length === 1
      ? `${columns[0]} = EXCLUDED.${columns[0]}`
      : `(${columns.join(", ")}) = (${columns.map((c) => `EXCLUDED.${c}`).join(", ")})`;
  return `INSERT INTO public.${table} SELECT * FROM ${STAGING}.${table}
          ON CONFLICT (id) DO UPDATE SET ${set}`;
}

/** An id from a request, going into raw SQL. */
function asUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("not a manuscript id");
  }
  return value;
}

/** Which manuscripts a backup holds, so one of them can be chosen. */
export async function worksInBackup(name: string): Promise<{ id: string; title: string }[]> {
  const dumped = await run("pg_restore", [
    "--data-only",
    "--no-owner",
    "--no-acl",
    "--table=works",
    "--file=-",
    backupPath(name),
  ]);

  // The data section is tab separated, one row per line, between the COPY
  // header and its terminator. Only two columns are wanted and neither can
  // contain a tab.
  const lines = dumped.split("\n");
  const start = lines.findIndex((l) => l.startsWith("COPY public.works "));
  if (start === -1) return [];

  const header = lines[start] ?? "";
  const columns = header.slice(header.indexOf("(") + 1, header.indexOf(")")).split(", ");
  const idAt = columns.indexOf("id");
  const titleAt = columns.indexOf("title");
  if (idAt === -1 || titleAt === -1) return [];

  const works: { id: string; title: string }[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line === undefined || line === "\\.") break;
    if (!line.trim()) continue;
    const cells = line.split("\t");
    const id = cells[idAt];
    const title = cells[titleAt];
    if (id && title) works.push({ id, title });
  }
  return works;
}
