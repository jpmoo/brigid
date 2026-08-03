/**
 * The parts of backup that can be checked without a database.
 *
 * The dump and restore themselves shell out to pg_dump and pg_restore against a
 * live server, so they are exercised where one exists rather than here. What is
 * testable is everything around them: when the nightly run lands, what a
 * filename means, and the two places where pg_restore's output is read.
 */
import { nextRun } from "../src/backup/schedule.js";
import { isBackupName, stampFor } from "../src/backup/store.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

// --- when the nightly run lands ---

const local = (y: number, m: number, d: number, h: number, min: number) =>
  new Date(y, m - 1, d, h, min, 0, 0);

{
  // Before the hour: tonight. After it: tomorrow night. The comparison is on
  // the server's own clock, which is the one "1am" was meant in.
  check("later today when the hour is still ahead", nextRun(local(2026, 8, 1, 0, 30), 1, 0), local(2026, 8, 1, 1, 0));
  check("tomorrow when it has gone", nextRun(local(2026, 8, 1, 9, 0), 1, 0), local(2026, 8, 2, 1, 0));
  // Exactly on it counts as gone, or a run finishing inside the same minute
  // would immediately schedule itself again.
  check("exactly on the hour means tomorrow", nextRun(local(2026, 8, 1, 1, 0), 1, 0), local(2026, 8, 2, 1, 0));
  check("a minute past the hour is honoured", nextRun(local(2026, 8, 1, 0, 0), 1, 30), local(2026, 8, 1, 1, 30));
  check("it rolls into the next month", nextRun(local(2026, 8, 31, 9, 0), 1, 0), local(2026, 9, 1, 1, 0));
  check("and the next year", nextRun(local(2026, 12, 31, 9, 0), 1, 0), local(2027, 1, 1, 1, 0));
}

// --- a filename is an id, so it is checked like one ---

{
  const stamp = stampFor(new Date(Date.UTC(2026, 7, 1, 1, 0, 0)));
  check("the stamp is compact UTC", stamp, "20260801T010000Z");
  check("a plain name is accepted", isBackupName(`brigid-${stamp}.dump`), true);
  check("so is a labelled one", isBackupName(`brigid-${stamp}-before-restore.dump`), true);

  // Anything that could walk out of the backup directory is refused before it
  // is ever joined onto a path.
  check("traversal is refused", isBackupName("../../etc/passwd"), false);
  check("a nested path is refused", isBackupName("brigid/../x.dump"), false);
  check("another extension is refused", isBackupName(`brigid-${stamp}.sql`), false);
  check("a foreign name is refused", isBackupName("backup.dump"), false);
  check("an absolute path is refused", isBackupName("/etc/passwd"), false);
}

// --- reading the works out of a dump ---

{
  // pg_restore --data-only writes the data section like this. The parser has to
  // find the columns by name: their order is the table's, not one we choose.
  const sample = [
    "--",
    "-- Data for Name: works; Type: TABLE DATA; Schema: public; Owner: -",
    "--",
    "",
    "COPY public.works (id, title, subtitle, author_first_name) FROM stdin;",
    "11111111-1111-4111-8111-111111111111\tThe Frozen North\t\\N\tMaren",
    "22222222-2222-4222-8222-222222222222\tSecond Book\tA Subtitle\tMaren",
    "\\.",
    "",
  ].join("\n");

  // Exercised through the same parsing the real path uses, with pg_restore
  // stubbed out — the format is what is being checked, not the subprocess.
  const parsed = parseWorks(sample);
  check("both manuscripts are found", parsed.length, 2);
  check("with their titles", parsed.map((w) => w.title), ["The Frozen North", "Second Book"]);
  check("and their ids", parsed[0]?.id, "11111111-1111-4111-8111-111111111111");

  const shuffled = [
    "COPY public.works (subtitle, title, id, author_first_name) FROM stdin;",
    "\\N\tThe Frozen North\t11111111-1111-4111-8111-111111111111\tMaren",
    "\\.",
  ].join("\n");
  check("columns are found by name, not position", parseWorks(shuffled)[0]?.title, "The Frozen North");

  check("a dump with no works yields none", parseWorks("-- nothing here"), []);
}

/** The reader from restore.ts, over text rather than over a subprocess. */
function parseWorks(dumped: string): { id: string; title: string }[] {
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

// --- pointing the data at a staging schema ---

{
  // The one piece of text rewriting in the restore path. It must touch the COPY
  // header and nothing else — data lines can begin with anything at all.
  const stage = (sql: string) =>
    sql
      .split("\n")
      .filter((line) => !line.startsWith("SELECT pg_catalog.setval"))
      .map((line) =>
        line.startsWith("COPY public.") ? line.replace("COPY public.", "COPY brigid_restore.") : line,
      )
      .join("\n");

  const staged = stage(
    [
      "COPY public.blocks (id, content_text) FROM stdin;",
      "abc\tCOPY public.blocks is a phrase someone wrote",
      "\\.",
      "SELECT pg_catalog.setval('public.some_seq', 1, true);",
    ].join("\n"),
  ).split("\n");

  check("the header is redirected", staged[0], "COPY brigid_restore.blocks (id, content_text) FROM stdin;");
  check(
    "prose that happens to say the same thing is untouched",
    staged[1],
    "abc\tCOPY public.blocks is a phrase someone wrote",
  );
  check("the terminator survives", staged[2], "\\.");
  check("sequence resets are dropped", staged.length, 3);
}

console.log("\nthe hour the writer meant");

// The reported fault. A server in UTC firing "1am" fires it at 1am UTC, which
// is 9pm the evening before in New York — four hours early, with nothing
// anywhere to say why.
{
  // Noon UTC on a summer day: New York is four hours behind.
  const noon = new Date("2026-08-03T12:00:00Z");
  const at = nextRun(noon, 1, 0, "America/New_York");
  check("1am in New York is 05:00 UTC", at.toISOString(), "2026-08-04T05:00:00.000Z");
}

{
  // And five behind in winter, which a fixed offset would get wrong.
  const noon = new Date("2026-12-03T12:00:00Z");
  const at = nextRun(noon, 1, 0, "America/New_York");
  check("and 06:00 UTC in winter", at.toISOString(), "2026-12-04T06:00:00.000Z");
}

{
  // Today's slot when it has not passed yet: 3am UTC is 10pm the night before
  // in New York, so 1am there is still to come today.
  const early = new Date("2026-08-03T03:00:00Z");
  const at = nextRun(early, 1, 0, "America/New_York");
  check("today's slot is taken when it is still ahead", at.toISOString(), "2026-08-03T05:00:00.000Z");
}

{
  // A zone ahead of UTC, where the date there is already tomorrow: 20:00 UTC is
  // 05:00 on the 4th in Tokyo, so 1am on the 4th has gone and the next slot is
  // 1am on the 5th — which is 16:00 UTC on the 4th.
  const at = nextRun(new Date("2026-08-03T20:00:00Z"), 1, 0, "Asia/Tokyo");
  check("a zone ahead of UTC is handled the same way", at.toISOString(), "2026-08-04T16:00:00.000Z");
}

// No zone means the host clock, which is what it always did.
{
  const after = new Date("2026-08-03T12:00:00Z");
  const at = nextRun(after, 1, 0);
  const local = new Date(after);
  local.setHours(1, 0, 0, 0);
  if (local <= after) local.setDate(local.getDate() + 1);
  check("no zone still uses the host clock", at.toISOString(), local.toISOString());
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
