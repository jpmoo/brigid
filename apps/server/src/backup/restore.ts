import { sql } from "drizzle-orm";
import { runMigrations } from "@brigid/db";
import { closeDb, db, initDb } from "../db.js";
import { backupPath, onlyExtensionComplaints, run, takeBackup } from "./store.js";

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
    await run(
      "pg_restore",
      [
        "--clean",
        // Without this, every DROP of something the backup expects but this
        // database hasn't got is an error rather than a no-op.
        "--if-exists",
        "--no-owner",
        "--no-acl",
        `--dbname=${databaseUrl}`,
        backupPath(name),
      ],
      // The app's role does not own the database's extensions, so `--clean`
      // is refused when it tries to drop them and exits non-zero having
      // restored everything that matters. See onlyExtensionComplaints.
      { tolerate: onlyExtensionComplaints },
    );
    // The dump carries the schema it was taken with, which may be older than
    // this code — restoring one from before a migration puts the database back
    // behind the app, and the first thing to break is whatever that migration
    // added. Brought forward before anything is allowed to query it.
    await runMigrations(databaseUrl);
  } finally {
    // Reconnected whatever happened: a half-restored database still has to be
    // reachable, or the writer cannot even get back in to try the safety copy.
    initDb(databaseUrl);
  }

  // A restore that failed part way can leave this behind, and it is confusing
  // to find in a database that has no other explanation for it.
  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${STAGING} CASCADE`)).catch(() => {});

  return safety.name;
}

/** The tables a manuscript lives in, in the order they can be written. */
const WORK_TABLES = ["works", "work_levels", "blocks", "bookmarks"] as const;
const STAGING = "brigid_restore";

/**
 * One manuscript, out of a backup of everything.
 *
 * There is no menu of pieces here on purpose. A manuscript is not separable
 * from the things that decide how it reads: its levels, the breaks and formats
 * it has edited for itself, the formats it points at. Those are what it *is*,
 * so they come back with it and there is nothing to tick. Anything wider than
 * one manuscript is the whole database, which is the other choice.
 *
 * The dump holds everything, so this manuscript's rows have to be separated
 * from the rest before anything is touched. They are loaded into a schema of
 * their own — which needs no privilege beyond owning the database, unlike the
 * more obvious approach of restoring into a scratch one — and copied across
 * inside a single transaction, so a failure part way leaves nothing
 * half-applied.
 *
 * pg_restore writes its data section as `COPY public.<table>`, so staging is a
 * matter of pointing those lines at the other schema. That is the only text
 * handling here, and it touches the COPY header alone; the data is never parsed.
 */
export async function restoreWork(
  databaseUrl: string,
  name: string,
  workId: string,
): Promise<{ safety: string; restored: string[] }> {
  const id = asUuid(workId);
  const safety = (await takeBackup(databaseUrl, "before-restore")).name;

  // Formats are staged alongside: a block points at one, and the backup may
  // hold a format this database no longer has.
  const tables = [...WORK_TABLES, "templates"];

  const dumped = await run("pg_restore", [
    "--data-only",
    "--no-owner",
    "--no-acl",
    ...tables.map((t) => `--table=${t}`),
    "--file=-",
    backupPath(name),
  ]);

  const staged = stageOnly(dumped, tables);

  await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${STAGING} CASCADE`));
  await db.execute(sql.raw(`CREATE SCHEMA ${STAGING}`));
  for (const table of tables) {
    // Structure only — no keys, so the load cannot fail on whatever order the
    // dump happens to use, and none of it outlives this call anyway.
    await db.execute(
      sql.raw(`CREATE TABLE ${STAGING}.${table} (LIKE public.${table} INCLUDING DEFAULTS)`),
    );
  }

  try {
    await run("psql", ["--quiet", "--no-psqlrc", "--set=ON_ERROR_STOP=1", databaseUrl], {
      stdin: staged,
    });

    const rows = await db.execute<{ title: string }>(
      sql.raw(`SELECT title FROM ${STAGING}.works WHERE id = '${id}'`),
    );
    const found = Array.isArray(rows) ? rows[0] : undefined;
    if (!found) throw new Error("that manuscript is not in this backup");

    /**
     * One connection, one transaction.
     *
     * Emphatically not a hand-written BEGIN/COMMIT through `db.execute`. The
     * pool hands out whatever connection is free per statement, so those three
     * words can land on three different connections: the BEGIN opens a
     * transaction on one, the DELETE commits on its own somewhere else, and the
     * COMMIT closes nothing. A failure between them then leaves the manuscript
     * deleted with nothing put back — and the connection still holding an open
     * transaction, which poisons every request that later lands on it.
     *
     * `transaction` reserves a single connection for the whole block and
     * rolls it back on any throw, which is the only thing that makes the delete
     * and the insert one action.
     */
    await db.transaction(async (tx) => {
      // Only the formats this database is missing. A format is shared, and
      // rewriting one to suit a single manuscript would change every other
      // manuscript using it — while this manuscript's own departures from a
      // format are stored on its blocks and come back with them regardless.
      await tx.execute(
        sql.raw(
          `INSERT INTO public.templates SELECT * FROM ${STAGING}.templates
           ON CONFLICT (id) DO NOTHING`,
        ),
      );

      // Replaced wholesale. Its children cascade, so removing it clears the
      // blocks and bookmarks of the version being discarded rather than leaving
      // them to collide with the ones coming in.
      await tx.execute(sql.raw(`DELETE FROM public.works WHERE id = '${id}'`));
      for (const table of WORK_TABLES) {
        const column = table === "works" ? "id" : "work_id";
        await tx.execute(
          sql.raw(
            `INSERT INTO public.${table}
             SELECT * FROM ${STAGING}.${table} WHERE ${column} = '${id}'`,
          ),
        );
      }
    });

    return { safety, restored: [found.title] };
  } finally {
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS ${STAGING} CASCADE`));
  }
}


/**
 * Rewrites a dump's data section for the staging schema, and refuses the rest.
 *
 * This stream is executed against the live database, and every byte of it came
 * out of a file somebody was handed. pg_restore emits the COPY statement text
 * stored in the archive, followed by the archive's own data bytes — neither is
 * anything this app wrote. Rewriting the lines that begin `COPY public.` and
 * passing everything else through meant a crafted archive could close its data
 * section with a terminator and have whatever followed run as the database
 * owner: rewriting the password hash, reading the other manuscripts, dropping
 * the schema. The restore is scoped to one manuscript; the file was not.
 *
 * So nothing passes unless it is recognised. Outside a data section only blank
 * lines, comments, SET, and a COPY header naming one of the tables asked for
 * are allowed. Inside one, every line is data until the terminator, and data is
 * never interpreted. Anything else stops the restore rather than being handed
 * to psql to make sense of.
 */
export function stageOnly(dumped: string, tables: readonly string[]): string {
  const wanted = new Set(tables);
  const out: string[] = [];
  let copying = false;

  for (const line of dumped.split("\n")) {
    if (copying) {
      out.push(line);
      // The terminator is a line of its own; a data row that looked like one
      // would have been escaped by pg_dump on the way in.
      if (line === "\\.") copying = false;
      continue;
    }

    if (line.trim() === "" || line.startsWith("--")) {
      out.push(line);
      continue;
    }

    // Settings pg_dump writes around its data, and nothing else.
    if (/^SET [A-Za-z_]+ = /.test(line) || /^SELECT pg_catalog\.set_config\(/.test(line)) {
      out.push(line);
      continue;
    }

    // Sequence positions belong to the real schema, not to a staging copy.
    if (line.startsWith("SELECT pg_catalog.setval")) continue;

    const header = /^COPY public\.("?)([A-Za-z_][A-Za-z0-9_]*)\1 \(/.exec(line);
    if (header) {
      const table = header[2] ?? "";
      if (!wanted.has(table)) {
        throw new Error(`this backup carries data for ${table}, which was not asked for`);
      }
      out.push(line.replace("COPY public.", `COPY ${STAGING}.`));
      copying = true;
      continue;
    }

    throw new Error(
      "this backup contains statements a restore should not run — it may not be a Brigid backup",
    );
  }

  if (copying) throw new Error("this backup ends in the middle of a table");
  return out.join("\n");
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
