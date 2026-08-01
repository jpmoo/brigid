/**
 * Compiling a manuscript, end to end — the plan, and both files it becomes.
 *
 * Written out to real bytes and read back rather than asserted on the objects
 * in between: the whole point of this feature is a file someone else opens, so
 * what is checked is what the file actually contains.
 */
import { unzipSync, strFromU8 } from "fflate";
import { compileManuscript } from "../src/compile/plan.js";
import { toDocx } from "../src/compile/docx.js";
import { toPdf } from "../src/compile/pdf.js";
import type { LevelLike, TemplateLike } from "@brigid/shared";

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

const templates: TemplateLike[] = [
  {
    id: "regular",
    category: "block-format",
    name: "Regular text",
    body: { nodes: [{ type: "content" }] },
    breakSettings: null,
    formatSettings: {
      countsTowardWordCount: true,
      structural: true,
      typography: { fontFamily: '"Courier New", monospace', fontSizePt: 12, lineHeight: 2.25, firstLineIndentIn: 0.5 },
    },
  },
  {
    id: "titlepage",
    category: "block-format",
    name: "Title page",
    body: {
      nodes: [
        {
          type: "table",
          columns: [{ width: 50, align: "left" }, { width: 50, align: "right" }],
          borders: { outer: false, rows: false, columns: false, widthPt: 1 },
          rows: [
            {
              cells: [
                { content: [{ type: "variable", name: "authorFullName" }], verticalAlign: "top" },
                { content: [{ type: "variable", name: "totalWordCount" }, { type: "text", text: " words" }], align: "right", verticalAlign: "top" },
              ],
            },
            {
              cells: [
                { content: [{ type: "variable", name: "manuscriptTitle" }], align: "center" },
                { content: [], align: "center" },
              ],
            },
          ],
        },
        // Deliberately here: a trailing break on the title page must not become
        // a blank page, because the section boundary already turns the page.
        { type: "pageBreak" },
      ],
    },
    breakSettings: null,
    formatSettings: { countsTowardWordCount: false, structural: false },
  },
  {
    id: "chapbreak",
    category: "break",
    name: "Chapter break",
    body: {
      nodes: [
        { type: "pageBreak" },
        {
          type: "paragraph",
          align: "center",
          content: [
            { type: "text", text: "Chapter " },
            { type: "variable", name: "levelCounter", numberFormat: "words-title" },
          ],
        },
      ],
    },
    breakSettings: { suppressOnFirstChild: false },
    formatSettings: null,
  },
];

const levels: LevelLike[] = [{ depth: 0, name: "Chapter", breakTemplateId: "chapbreak", counterRestart: "continuous" }];

const block = (id: string, formatId: string, sortKey: string, text: string) => ({
  id,
  parentId: null,
  sortKey,
  label: id,
  formatId,
  wordCount: text.split(/\s+/).filter(Boolean).length,
  contentText: text,
  content: null,
  breakTemplateId: null,
  breakBody: null,
  formatBody: null,
  formatTypography: null,
  options: null,
});

const rows = [
  block("t", "titlepage", "a", ""),
  block("one", "regular", "b", "The ice had come early that year.\n\nBrandan had not waited."),
  block("two", "regular", "c", "Brandan was gone by morning."),
];

const build = (options: Parameters<typeof compileManuscript>[1]) =>
  compileManuscript(
    {
      blocks: rows,
      levels,
      templates,
      work: { title: "The Frozen North", subtitle: null, authorFirstName: "Maren", authorLastName: "Halloran" },
      prose: new Map(rows.map((b) => [b.id, { content: b.content, contentText: b.contentText }])),
      structural: (formatId) => templates.find((t) => t.id === formatId)?.formatSettings?.structural ?? true,
    },
    options,
  );

// --- the plan ---

{
  const m = build({ runningHeads: true, shortTitle: "North" });
  /** Everything readable, wherever it sits — lines and table cells alike. */
  const text = (nodes: typeof m.body): string =>
    nodes
      .flatMap((n) => {
        if (n.kind === "pageBreak") return ["\f"];
        if (n.kind === "line") return n.line.runs.map((r) => r.text);
        return n.table.rows.flatMap((row) =>
          row.cells.flatMap((cell) => cell.lines.flatMap((line) => line.runs.map((r) => r.text))),
        );
      })
      .join("");

  // The title page is front matter: it is not page one and carries no head.
  check("the title page is kept apart from the body", text(m.front).includes("The Frozen North"), true);
  check("and the writing is not in the front matter", text(m.front).includes("The ice had come"), false);
  check("both chapters are in the body", [text(m.body).includes("The ice had come"), text(m.body).includes("Brandan was gone")], [true, true]);
  check("the chapter break came with them", text(m.body).includes("Chapter One"), true);

  // Shunn: surname, short title, page — the short title defaults to the real
  // one, capitalised.
  // Shunn: surname, short title, page. The short word is required and shown
  // capitalised however it was typed.
  check("the running head is the short title, capitalised", m.runningHead, { surname: "Halloran", shortTitle: "NORTH" });
  check("however it was typed", build({ runningHeads: true, shortTitle: "north" }).runningHead?.shortTitle, "NORTH");
  check("and heads can be declined", build({ runningHeads: false, shortTitle: "North" }).runningHead, null);

  // Selection.
  const one = build({ runningHeads: true, shortTitle: "North", include: ["one"] });
  check("only what was chosen is compiled", [
    one.body.some((n) => n.kind === "line" && n.line.runs.some((r) => r.text.includes("The ice"))),
    one.body.some((n) => n.kind === "line" && n.line.runs.some((r) => r.text.includes("Brandan was gone"))),
  ], [true, false]);
  check("leaving out the title page leaves the front matter empty", one.front.length, 0);

  // Typography is inherited, never asked for.
  const lineWith = (needle: string) => {
    const found = m.body.find((n) => n.kind === "line" && n.line.runs.some((r) => r.text.includes(needle)));
    return found && found.kind === "line" ? found.line : null;
  };
  const opening = lineWith("The ice");
  const second = lineWith("Brandan had not waited");
  check("the prose takes the format's face and spacing", [opening?.fontSizePt, opening?.lineHeight], [12, 2.25]);
  // The paragraph opening a chapter runs flush; the next one is indented.
  check("the opening paragraph runs flush", opening?.firstLineIndentIn, 0);
  check("and the one after it is indented", second?.firstLineIndentIn, 0.5);
}

// --- the Word file ---

{
  const file = await toDocx(build({ runningHeads: true, shortTitle: "North" }));
  check("it is a zip", [file[0], file[1]], [0x50, 0x4b]);

  const entries = unzipSync(new Uint8Array(file));
  const names = Object.keys(entries);
  check("with a document inside", names.includes("word/document.xml"), true);

  const xml = strFromU8(entries["word/document.xml"] as Uint8Array);
  // Read with the tags taken out: a line built from a literal and a variable is
  // two runs, so "Chapter One" is never contiguous in the markup even though it
  // is contiguous on the page.
  const words = xml.replace(/<[^>]+>/g, "");
  check("the writing is in it", words.includes("The ice had come early that year."), true);
  check("so is the chapter break", words.includes("Chapter One"), true);

  // Two sections: the title page's, then the body's, which starts at page one.
  check("the body starts its own numbering at one", /w:pgNumType[^>]*w:start="1"/.test(xml), true);
  check("one inch margins", /w:top="1440"/.test(xml) && /w:left="1440"/.test(xml), true);

  const header = names.find((n) => /^word\/header\d*\.xml$/.test(n));
  check("there is a running head", Boolean(header), true);
  const headerXml = header ? strFromU8(entries[header] as Uint8Array) : "";
  check("naming the author and the short title", headerXml.includes("Halloran / NORTH"), true);
  check("and numbering by field rather than by hand", headerXml.includes("PAGE"), true);

  const plain = await toDocx(build({ runningHeads: false, shortTitle: "North" }));
  const plainNames = Object.keys(unzipSync(new Uint8Array(plain)));
  check("declining heads leaves none in the file", plainNames.some((n) => /^word\/header/.test(n)), false);
}

// --- the PDF ---

{
  const file = await toPdf(build({ runningHeads: true, shortTitle: "North" }));
  check("it is a PDF", file.subarray(0, 5).toString("latin1"), "%PDF-");
  check("of some substance", file.length > 800, true);
  check("and it ends properly", file.subarray(-6).toString("latin1").includes("%%EOF"), true);

  const plain = await toPdf(build({ runningHeads: false, shortTitle: "North" }));
  check("one without heads is still a PDF", plain.subarray(0, 5).toString("latin1"), "%PDF-");
}

// --- tables, and the page that shouldn't be there ---

{
  const m = build({ runningHeads: true, shortTitle: "North" });

  const table = m.front.find((n) => n.kind === "table");
  check("a title page's table stays a table", Boolean(table), true);
  if (table && table.kind === "table") {
    check("with its rows and columns", [table.table.rows.length, table.table.rows[0]?.cells.length], [2, 2]);
    check("and its column widths as shares", table.table.rows[0]?.cells.map((c) => c.width), [50, 50]);
    check("the title is in it", table.table.rows[1]?.cells[0]?.lines[0]?.runs[0]?.text, "The Frozen North");
  }

  // The section boundary turns the page; a break at either edge turns it again,
  // and the second one arrives blank.
  check("no page break is left at the end of the front matter", m.front[m.front.length - 1]?.kind === "pageBreak", false);
  check("nor at the start of the body", m.body[0]?.kind === "pageBreak", false);
  // The break between chapters is untouched — it is what separates them.
  check("but the breaks between chapters remain", m.body.some((n) => n.kind === "pageBreak"), true);

  // Without a head there is no short title to ask for.
  const bare = build({ runningHeads: false });
  check("a compile with no head needs no short title", bare.runningHead, null);
}

{
  // The Word file must carry a real table, not paragraphs pretending.
  const file = await toDocx(build({ runningHeads: true, shortTitle: "North" }));
  const xml = strFromU8(unzipSync(new Uint8Array(file))["word/document.xml"] as Uint8Array);
  check("Word gets a table element", xml.includes("<w:tbl>"), true);
  check("with two rows", (xml.match(/<w:tr>/g) ?? []).length >= 2, true);
  check("and the title inside a cell", /<w:tc>[\s\S]*?The Frozen North/.test(xml), true);
}

{
  // The case that was throwing: a title page table, prose, marks and breaks.
  const file = await toPdf(build({ runningHeads: true, shortTitle: "North" }));
  check("a manuscript with a table still makes a PDF", file.subarray(0, 5).toString("latin1"), "%PDF-");
  check("and it is complete", file.subarray(-6).toString("latin1").includes("%%EOF"), true);
}

// --- small caps keep the capitals they were given ---

{
  const capsTemplates = templates.map((t) =>
    t.id === "chapbreak"
      ? {
          ...t,
          body: {
            nodes: [
              {
                type: "paragraph",
                align: "center",
                content: [{ type: "text", text: "Chapter Nine", smallCaps: true }],
              },
            ],
          },
        }
      : t,
  );

  const m = compileManuscript(
    {
      blocks: rows,
      levels,
      templates: capsTemplates as never,
      work: { title: "T", subtitle: null, authorFirstName: "M", authorLastName: "H" },
      prose: new Map(rows.map((b) => [b.id, { content: b.content, contentText: b.contentText }])),
      structural: (id) =>
        capsTemplates.find((t) => t.id === id)?.formatSettings?.structural ?? true,
    },
    { runningHeads: false, shortTitle: "N" },
  );

  const head = m.body.find(
    (n) => n.kind === "line" && n.line.runs.some((r) => r.text.startsWith("C")),
  );
  const runs = head && head.kind === "line" ? head.line.runs : [];

  // "Chapter Nine" — the C and the N were already capitals and stay full size;
  // everything else becomes a capital at a smaller one. The space has no case
  // to lose, so it goes with the full-size letters rather than being set at
  // four fifths of a space.
  check("it is split by the case it was written in", runs.map((r) => r.text), ["C", "HAPTER", " N", "INE"]);
  check("the capitals stay full size", [runs[0]?.sizeScale, runs[2]?.sizeScale], [undefined, undefined]);
  check("and the rest are smaller", [runs[1]?.sizeScale, runs[3]?.sizeScale], [0.8, 0.8]);
  check("nothing is left lowercase", runs.every((r) => r.text === r.text.toUpperCase()), true);

  // All caps is still all caps: one run, everything capital, no size change.
  const allCaps = compileManuscript(
    {
      blocks: rows,
      levels,
      templates: templates.map((t) =>
        t.id === "chapbreak"
          ? { ...t, body: { nodes: [{ type: "paragraph", align: "center", content: [{ type: "text", text: "Chapter Nine", allCaps: true }] }] } }
          : t,
      ) as never,
      work: { title: "T", subtitle: null, authorFirstName: "M", authorLastName: "H" },
      prose: new Map(rows.map((b) => [b.id, { content: b.content, contentText: b.contentText }])),
      structural: () => true,
    },
    { runningHeads: false, shortTitle: "N" },
  );
  const loud = allCaps.body.find((n) => n.kind === "line" && n.line.runs.some((r) => r.text.includes("CHAPTER")));
  const loudRuns = loud && loud.kind === "line" ? loud.line.runs : [];
  check("all caps stays one run", loudRuns.map((r) => r.text), ["CHAPTER NINE"]);
  check("at one size", loudRuns[0]?.sizeScale, undefined);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
