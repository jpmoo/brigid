import {
  asProseDoc,
  autocorrectKeystroke,
  currentBlockAt,
  deriveDocument,
  foldApostrophes,
  foldForSearch,
  foldForSearchMapped,
  normalizeProse,
  parseInlines,
  possessiveStem,
  proseFromParagraphs,
  proseToText,
  serializeInlines,
} from "@brigid/shared";
import type { DocumentItem, LevelLike, TemplateLike } from "@brigid/shared";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

const fmt = (id: string, counts: boolean, structural: boolean): TemplateLike => ({
  id,
  category: "block-format",
  name: id,
  body: { nodes: [{ type: "content" }] },
  breakSettings: null,
  formatSettings: { countsTowardWordCount: counts, structural },
});

const templates: TemplateLike[] = [
  fmt("regular", true, true),
  fmt("titlepage", false, false),
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
  {
    id: "sectbreak",
    category: "break",
    name: "Section break",
    body: { nodes: [{ type: "paragraph", align: "center", content: [{ type: "text", text: "⁂" }] }] },
    breakSettings: { suppressOnFirstChild: true },
    formatSettings: null,
  },
];

const levels: LevelLike[] = [
  { depth: 0, name: "Chapter", breakTemplateId: "chapbreak", counterRestart: "continuous" },
  { depth: 1, name: "Scene", breakTemplateId: "sectbreak", counterRestart: "under-parent" },
];

const b = (id: string, parentId: string | null, sortKey: string, formatId: string, wordCount = 0, label: string | null = null) =>
  ({ id, parentId, sortKey, formatId, wordCount, label });

const blocks = [
  b("title", null, "a0", "titlepage"),
  b("ch1", null, "a1", "regular", 10, "The Crossing"),
  b("s1", "ch1", "b0", "regular", 100),
  b("s2", "ch1", "b1", "regular", 200),
  b("ch2", null, "a2", "regular", 20),
  b("s3", "ch2", "b0", "regular", 300),
];

const doc = deriveDocument({
  blocks,
  levels,
  templates,
  work: { title: "The Salt Road", subtitle: null, authorFirstName: "J", authorLastName: "Moore" },
});

const shape = doc.map((i) => (i.kind === "break" ? `break:${i.templateId}>${i.blockId}` : `block:${i.block.id}`));

console.log("\nDocument order:");
for (const s of shape) console.log("   ", s);
console.log();

check(
  "title page renders but gets no break (not structural)",
  shape.slice(0, 2),
  ["block:title", "break:chapbreak>ch1"],
);
check(
  "first scene under a chapter suppresses the ornament",
  shape.filter((s) => s.endsWith(">s1")),
  [],
);
check("second scene gets the ornament", shape.filter((s) => s.endsWith(">s2")), ["break:sectbreak>s2"]);
check("first scene of chapter 2 also suppressed", shape.filter((s) => s.endsWith(">s3")), []);

const chapterHeadings = doc
  .filter((i) => i.kind === "break" && i.templateId === "chapbreak")
  .map((i) => (i.kind === "break" ? i.nodes : []))
  .map((nodes) => nodes.filter((n) => n.type === "paragraph").map((n) => (n.type === "paragraph" ? n.spans.map((s) => s.text).join("") : "")))
  .flat();

check(
  "title page does not consume a chapter number; counters spell out",
  chapterHeadings,
  ["Chapter One", "Chapter Two"],
);

// --- the drag-and-drop premise: same blocks, one moved a level deeper --------
const moved = blocks.map((x) => (x.id === "ch2" ? { ...x, parentId: "ch1", sortKey: "b2" } : x));
const doc2 = deriveDocument({
  blocks: moved,
  levels,
  templates,
  work: { title: "The Salt Road", subtitle: null, authorFirstName: "J", authorLastName: "Moore" },
});
const ch2Break = doc2.find((i) => i.kind === "break" && i.blockId === "ch2");
check(
  "moving a block one level deeper changes the break before it",
  ch2Break && ch2Break.kind === "break" ? ch2Break.templateId : null,
  "sectbreak",
);

// --- opening-paragraph indent ----------------------------------------------
const indentOf = (d: ReturnType<typeof deriveDocument>) =>
  d.filter((i) => i.kind === "block").map((i) => (i.kind === "block" ? i.firstLineIndent : null));

check(
  "flush after a break by default; indented when merely continuing",
  indentOf(doc),
  // title(first) ch1(after break) s1(continues) s2(after break) ch2(after break) s3(continues)
  [false, false, true, false, false, true],
);

const indenting = templates.map((t) =>
  t.id === "chapbreak"
    ? { ...t, breakSettings: { suppressOnFirstChild: false, indentFirstParagraph: true } }
    : t,
);
check(
  "a break that opts in indents the paragraph it opens",
  indentOf(
    deriveDocument({
      blocks,
      levels,
      templates: indenting,
      work: { title: "T", subtitle: null, authorFirstName: null, authorLastName: null },
    }),
  ),
  [false, true, true, false, true, true],
);

// --- detached break instances ----------------------------------------------
// Editing one chapter break must not touch any other, and must survive a move
// that would otherwise re-derive the break from a different level.
const detachedBody = {
  nodes: [
    {
      type: "paragraph" as const,
      align: "center" as const,
      content: [{ type: "text" as const, text: "CHAPTER TWO — THE CROSSING", allCaps: true }],
    },
  ],
};
const withInstance = blocks.map((x) =>
  x.id === "ch2" ? { ...x, breakTemplateId: "chapbreak", breakBody: detachedBody } : x,
);
const doc3 = deriveDocument({
  blocks: withInstance,
  levels,
  templates,
  work: { title: "The Salt Road", subtitle: null, authorFirstName: "J", authorLastName: "Moore" },
});
const headings3 = doc3
  .filter((i) => i.kind === "break")
  .map((i) => (i.kind === "break" ? i.nodes : []))
  .map((nodes) =>
    nodes
      .filter((n) => n.type === "paragraph")
      .map((n) => (n.type === "paragraph" ? n.spans.map((s) => s.text).join("") : ""))
      .join(""),
  )
  .filter(Boolean);

check(
  "an edited break replaces only its own; siblings keep the template",
  headings3,
  ["Chapter One", "⁂", "CHAPTER TWO — THE CROSSING"],
);
check(
  "the edited break is flagged as detached, the others are not",
  doc3.filter((i) => i.kind === "break").map((i) => (i.kind === "break" ? i.detached : null)),
  [false, false, true],
);

// Same block, now nested a level deeper: the instance wins over the new level.
const movedWithInstance = withInstance.map((x) =>
  x.id === "ch2" ? { ...x, parentId: "ch1", sortKey: "b2" } : x,
);
const doc4 = deriveDocument({
  blocks: movedWithInstance,
  levels,
  templates,
  work: { title: "The Salt Road", subtitle: null, authorFirstName: "J", authorLastName: "Moore" },
});
const movedBreak = doc4.find((i) => i.kind === "break" && i.blockId === "ch2");
check(
  "an edited break survives a move that would otherwise change it",
  movedBreak && movedBreak.kind === "break"
    ? movedBreak.nodes
        .filter((n) => n.type === "paragraph")
        .map((n) => (n.type === "paragraph" ? n.spans.map((s) => s.text).join("") : ""))
    : null,
  ["CHAPTER TWO — THE CROSSING"],
);

// --- unresolved page variables --------------------------------------------
const withPageVar = deriveDocument({
  blocks: [b("only", null, "a0", "hdr")],
  levels: [],
  templates: [
    {
      id: "hdr",
      category: "block-format",
      name: "hdr",
      body: {
        nodes: [
          {
            type: "paragraph",
            content: [
              { type: "variable", name: "pageNumber" },
              { type: "text", text: " / " },
              { type: "variable", name: "totalWordCount" },
            ],
          },
        ],
      },
      breakSettings: null,
      formatSettings: { countsTowardWordCount: false, structural: false },
    },
  ],
  work: { title: "T", subtitle: null, authorFirstName: null, authorLastName: null },
});
const spans = withPageVar[0]?.kind === "block" ? withPageVar[0].nodes[0] : null;
check(
  "page-scoped variables become visible placeholders, document-scoped resolve",
  spans && spans.type === "paragraph" ? spans.spans.map((s) => `${s.text}${s.placeholder ? "*" : ""}`) : null,
  ["[page number]*", " / ", "0"],
);

// --- empty values collapse rather than leaving stray lines ------------------
const noSubtitle = deriveDocument({
  blocks: [b("t", null, "a0", "tp")],
  levels: [],
  templates: [
    {
      id: "tp",
      category: "block-format",
      name: "tp",
      body: {
        nodes: [
          { type: "paragraph", align: "center", content: [{ type: "variable", name: "manuscriptTitle" }] },
          { type: "paragraph", align: "center", content: [{ type: "variable", name: "manuscriptSubtitle" }] },
        ],
      },
      breakSettings: null,
      formatSettings: { countsTowardWordCount: false, structural: false },
    },
  ],
  work: { title: "The Salt Road", subtitle: null, authorFirstName: null, authorLastName: null },
});
check(
  "a paragraph of only-empty variables is dropped",
  noSubtitle[0]?.kind === "block" ? noSubtitle[0].nodes.length : null,
  1,
);

// --- subtree word totals ----------------------------------------------------
// A chapter's own row holds no prose; the scenes beneath it do.
{
  const { subtreeWordCounts } = await import("@brigid/shared");
  const { buildOutline } = await import("@brigid/shared");
  const totals = subtreeWordCounts(buildOutline(blocks));
  check("a chapter counts everything beneath it", totals.get("ch1"), 10 + 100 + 200);
  check("a leaf counts only itself", totals.get("s2"), 200);
  check("a childless block is unaffected", totals.get("title"), 0);
}

// --- template text tokens ---------------------------------------------------
check(
  "variable tokens round-trip through the text editor form",
  serializeInlines(parseInlines("Chapter {{levelCounter:words-title}} — {{levelTitle}}")),
  "Chapter {{levelCounter:words-title}} — {{levelTitle}}",
);
check(
  "an unknown token stays literal instead of vanishing",
  parseInlines("keep {{notAVariable}} intact").map((i) =>
    i.type === "text" ? i.text : i.type === "variable" ? i.name : i.type,
  ),
  ["keep {{notAVariable}} intact"],
);
check(
  "marks apply to every span parsed from one paragraph",
  parseInlines("Chapter {{levelCounter}}", { smallCaps: true }).every(
    (i) => (i.type === "text" || i.type === "variable") && i.smallCaps === true,
  ),
  true,
);

// --- typeset punctuation -----------------------------------------------------
{
  const { smartenText } = await import("@brigid/shared");
  check(
    "quotes turn the right way and apostrophes stay apostrophes",
    smartenText(`"Don't," she said. "It's the '90s."`),
    "“Don’t,” she said. “It’s the ’90s.”",
  );
  check("double hyphen is an em dash, triple an en", smartenText("a--b---c"), "a—b–c");
  check("three dots become an ellipsis", smartenText("wait..."), "wait…");
  check(
    "a quote opening after an em dash still opens",
    smartenText(`—"Yes."`),
    "—“Yes.”",
  );
}

// --- prose model ---

{
  const doc = proseFromParagraphs(["One two.", "", "Three."]);
  check("blank paragraphs survive a round trip", proseToText(doc), "One two.\n\n\n\nThree.");
  check("a doc reads back as itself", asProseDoc(doc), doc);
  check("anything else is not a doc", asProseDoc({ type: "paragraph" }), null);
}

{
  // Neighbouring runs that carry the same marks are one run, or every keystroke
  // in a bold passage would become its own.
  const merged = normalizeProse({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "so", marks: [{ type: "strong" }] },
          { type: "text", text: "on", marks: [{ type: "strong" }] },
          { type: "text", text: " after" },
          { type: "text", text: "" },
        ],
      },
    ],
  });
  const runs = merged.content[0]?.content ?? [];
  check("runs with the same marks fuse", [runs.length, runs[0]?.text], [2, "soon"]);
}

{
  // Underline is a mark like the other two, and must not fuse with them.
  const kept = normalizeProse({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "plain " },
          { type: "text", text: "under", marks: [{ type: "underline" }] },
          { type: "text", text: "lined", marks: [{ type: "underline" }] },
          { type: "text", text: " and ", marks: [{ type: "em" }] },
        ],
      },
    ],
  });
  const runs = kept.content[0]?.content ?? [];
  check("underlined runs fuse with each other", [runs.length, runs[1]?.text], [3, "underlined"]);
  check(
    "but not with differently marked neighbours",
    runs.map((r) => (r.marks ?? []).map((m) => m.type).join("+")),
    ["", "underline", "em"],
  );
  check("underline survives a round trip", asProseDoc(kept), kept);
  check("empty runs are dropped", runs.every((r) => r.text.length > 0), true);
}

// --- autocorrect, as it is typed ---

/** Types a string a character at a time, exactly as the editor feeds it. */
function typed(input: string): string {
  let out = "";
  for (const ch of input) {
    const fix = autocorrectKeystroke(ch, out);
    if (!fix) {
      out += ch;
      continue;
    }
    out = out.slice(0, out.length - fix.replace) + fix.text;
  }
  return out;
}

check("dialogue gets the quotes the right way round", typed('He said "no."'), "He said \u201cno.\u201d");
check("an apostrophe inside a word stays one", typed("don't"), "don\u2019t");
check("single quotes open and close", typed("'Tis a wonder,' she said"), "\u2018Tis a wonder,\u2019 she said");
check("two hyphens make an em dash, three an en", [typed("wait--no"), typed("wait---no")], ["wait\u2014no", "wait\u2013no"]);
check("three dots make an ellipsis while typing", typed("well..."), "well\u2026");
// Interrupted dialogue: the quote after a dash closes, since nothing follows
// it yet to say otherwise.
check("a quote after a dash closes the speech", typed('"Stop--" she began.'), "\u201cStop\u2014\u201d she began.");
// The digit is what reveals it, and it arrives one keystroke late.
check("an elided decade turns round when the digit lands", typed("the '90s"), "the \u201990s");
check("a lone hyphen is left alone", typed("a-b"), "a-b");
check("decimal points are not an ellipsis", typed("1.5.2"), "1.5.2");

// --- which block the reader is in ---

{
  // A break, its block, then two more blocks — document order, as rendered.
  const at = (tops: number[]) =>
    ["one", "one", "two", "three"].map((id, i) => ({ id, top: tops[i] as number }));
  const line = 100;

  // The pane and the sheet are both padded, so at rest everything sits below
  // the line. This is the case the old hit test could not answer at all.
  check(
    "at the top of a padded document the first block is current",
    currentBlockAt(at([120, 180, 400, 700]), line),
    "one",
  );
  check(
    "the break counts as the start of its block",
    currentBlockAt(at([90, 180, 400, 700]), line),
    "one",
  );
  check(
    "the last item to cross the line wins",
    currentBlockAt(at([-300, -240, -20, 700]), line),
    "two",
  );
  check(
    "scrolled to the end, the last block is current",
    currentBlockAt(at([-900, -840, -600, -200]), line),
    "three",
  );
  check("an empty document has no current block", currentBlockAt([], line), null);
}

// --- what counts as the same word ---

{
  // The manuscript holds the typeset apostrophe; every word list is written
  // with the typewriter one. A word taught in one form must be found in the
  // other, which is what went wrong with "Brandan\u2019s".
  check("the typeset apostrophe folds to a straight one", foldApostrophes("Brandan\u2019s"), "Brandan's");
  check("a straight one is left alone", foldApostrophes("Brandan's"), "Brandan's");
  check("and the rest of the word is untouched", foldApostrophes("caf\u00e9"), "caf\u00e9");

  check("a possessive gives up its name", possessiveStem("Brandan\u2019s"), "Brandan");
  check("however the apostrophe is drawn", possessiveStem("Brandan's"), "Brandan");
  check("a plural possessive too", possessiveStem("Hallorans\u2019"), "Hallorans");
  check("a plain name has no stem", possessiveStem("Brandan"), null);
  // Not every trailing apostrophe is a plural possessive.
  check("nor does a word ending in a bare apostrophe", possessiveStem("rock'n'"), null);
}

// --- searching a typeset manuscript with a plain keyboard ---

{
  const prose = "Abbot Brandan\u2019s absence \u2014 and \u201cthe North,\u201d he said\u2026 quietly.";

  const find = (needle: string) => foldForSearch(prose).indexOf(foldForSearch(needle));
  check("a straight apostrophe finds a typeset one", find("Brandan's") >= 0, true);
  check("a straight quote finds a curled one", find('"the North,"') >= 0, true);
  check("a hyphen finds an em dash", find("absence - and") >= 0, true);
  // The one that needed a map: three dots for a character that is one.
  check("three dots find an ellipsis", find("said... quietly") >= 0, true);
  check("and the ellipsis finds itself", find("said\u2026 quietly") >= 0, true);
  check("nonsense still finds nothing", find("Brandanx"), -1);

  // The fold changes length now, so the map is what points a match at the real
  // characters. A folded range [a, b) is the real range [at[a], at[b]).
  const folded = foldForSearchMapped(prose);
  const slice = (needle: string) => {
    const n = foldForSearch(needle);
    const found = folded.text.indexOf(n);
    return prose.slice(folded.at[found] as number, folded.at[found + n.length] as number);
  };
  check("a match maps back to the typeset text", slice("Brandan's"), "Brandan\u2019s");
  check("including one that spans the ellipsis", slice("said... quietly"), "said\u2026 quietly");
  check("and one after it, whose offsets all moved", slice("quietly"), "quietly");
  check("the map has an entry past the end", folded.at.length, folded.text.length + 1);
  check("which is the length of the original", folded.at[folded.text.length], prose.length);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);

