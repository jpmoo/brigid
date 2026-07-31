import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planImport, suggestMarkers } from "@brigid/shared";
import { extractDocxParagraphs } from "../src/import/docx.js";

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

const here = dirname(fileURLToPath(import.meta.url));
const buf = readFileSync(join(here, "fixtures", "sample.docx"));
const paras = extractDocxParagraphs(new Uint8Array(buf));

check("every non-empty paragraph is extracted", paras.length, 12);
check(
  "an explicit page break carries forward to the next paragraph with content",
  paras.filter((p) => p.pageBreakBefore).map((p) => p.text.trim()),
  ["CHAPTER ONE"],
);

const plan = planImport({
  paragraphs: paras,
  firstPageIsTitlePage: true,
  markers: [
    { depth: 0, name: "Chapter", prefix: "CHAPTER " },
    { depth: 1, name: "Scene", prefix: "***" },
  ],
});

check("the first page becomes the title page, verbatim", plan.titlePage, [
  "The Salt Road",
  "A novel of the coast",
  "Jeff Moore",
  "12 Harbour Row, Anstruther",
]);
check(
  "markers open blocks at their level, and the remainder becomes the label",
  plan.blocks.map((b) => [b.depth, b.label, b.paragraphs.length]),
  [
    [0, "ONE", 2],
    [1, null, 1],
    [0, "TWO: The Crossing", 2],
  ],
);
// The lowercase "chapter houses were not the point." must stay prose.
check(
  "matching is case sensitive",
  plan.blocks[2]?.paragraphs.includes("chapter houses were not the point."),
  true,
);
check("marker tallies report what actually matched", plan.matches, [
  { depth: 0, prefix: "CHAPTER ", count: 2 },
  { depth: 1, prefix: "***", count: 1 },
]);

// Line feeds inside a heading must not stop it matching.
check(
  "line feeds are stripped before matching",
  planImport({
    paragraphs: [{ text: "CHAPTER \n THREE" }],
    markers: [{ depth: 0, name: "Chapter", prefix: "CHAPTER " }],
    firstPageIsTitlePage: false,
  }).blocks.map((b) => b.label),
  ["THREE"],
);


// --- The shape that was failing: no inserted breaks anywhere ----------------
// Title page ended by a section break, chapters using "page break before" —
// which is what Word's Heading styles set, so most manuscripts look like this.
const styled = extractDocxParagraphs(
  new Uint8Array(readFileSync(join(here, "fixtures", "styled.docx"))),
);

check(
  "page-break-before and section breaks are both detected",
  styled.filter((p) => p.pageBreakBefore).map((p) => p.text.trim()),
  ["CHAPTER ONE", "CHAPTER TWO", "CHAPTER THREE"],
);

const styledPlan = planImport({
  paragraphs: styled,
  firstPageIsTitlePage: true,
  markers: [
    { depth: 0, name: "Chapter", prefix: "CHAPTER " },
    { depth: 1, name: "Scene", prefix: "***" },
  ],
});
check("a section break bounds the title page", styledPlan.titlePage, [
  "Cold Harbour",
  "A novel",
  "Jeff Moore",
]);

// --- Detection --------------------------------------------------------------
const suggestions = suggestMarkers(styled);
check(
  "the document's own conventions are detected, with counts",
  suggestions.map((s) => [s.prefix, s.count, s.kind]),
  [
    ["CHAPTER ", 3, "prefix"],
    ["***", 2, "exact"],
  ],
);
check(
  "a one-off line is not mistaken for a convention",
  suggestMarkers([{ text: "***" }, { text: "Some prose here." }]).length,
  0,
);
check(
  "long paragraphs opening with a capitalised word are not headings",
  suggestMarkers([
    { text: `Maren ${"walked on and on ".repeat(8)}` },
    { text: `Maren ${"thought about it ".repeat(8)}` },
  ]).length,
  0,
);

// --- Manual title-page bound ------------------------------------------------
check(
  "an explicit paragraph count overrides page-break detection",
  planImport({
    paragraphs: styled,
    firstPageIsTitlePage: true,
    titlePageParagraphs: 2,
    markers: [{ depth: 0, name: "Chapter", prefix: "CHAPTER " }],
  }).titlePage,
  ["Cold Harbour", "A novel"],
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
