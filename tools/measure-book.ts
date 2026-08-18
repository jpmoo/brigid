import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { measure } from "../packages/shared/src/style.js";

/**
 * Measuring a published novel from a PDF, for the comparison set.
 *
 * The Gutenberg harvester next door cannot do this. It works from plain text
 * that someone else already transcribed, and a writer's own novel exists as a
 * typeset PDF — a thing built to be printed, not to be read by a program. What
 * comes out of a text extractor is not prose but a picture of a page described
 * in words: running heads, page numbers, ornaments between scenes, and every
 * paragraph broken across the lines it happened to occupy.
 *
 * All of that has to come off before a single number is taken, and none of it
 * announces itself. A running head left in place is a sentence; a page number
 * is a one-word paragraph; a novel whose paragraph breaks were not rebuilt
 * measures as one paragraph ninety thousand words long. The measurements come
 * out looking perfectly reasonable either way, which is what makes this worth
 * doing carefully rather than quickly.
 *
 * Only the numbers are kept, exactly as with the public-domain set. This matters
 * more here than there: these books are usually in copyright, and the whole
 * approach depends on never storing a word of them. A mean sentence length is a
 * fact about a book, not a piece of it, and a copy read once on the machine of
 * whoever holds it leaves nothing behind but arithmetic.
 *
 * The cleanup below is heuristic and shaped by the books it has been run on.
 * Run with --inspect on anything new and read the output before trusting it.
 */

const KEEP = [
  "sent.mean", "sent.sd", "sent.short", "sent.long",
  "punct.comma", "punct.semicolon", "punct.dash", "punct.exclaim", "punct.question",
  "para.words", "para.single",
  "lex.ttr", "lex.syllables", "lex.latinate", "lex.monosyll",
  "open.conjunction", "open.participle", "open.the",
  "pov.first", "pov.third", "pov.filtering", "pov.past",
  "mod.adverb", "mod.intensifier", "mod.hedge", "mod.negation",
  "tag.rate", "tag.said", "tag.adverb",
  "rhythm.syllPerSent",
];

interface Opts {
  /** Running heads, as they came out of the extractor. */
  heads?: RegExp[];
  /** Where the prose starts and stops — front matter and the bio are not prose. */
  from?: RegExp;
  to?: RegExp;
  /**
   * Ligatures the extractor could not map, as [wrong, right].
   *
   * A book set with a "Th" ligature can come out with every "The" written as
   * "!e", which is both a wrecked word and two thousand exclamation marks that
   * were never typed. Replaced only where a letter follows, so the exclamation
   * marks the writer did type — which sit before a space or a closing quote —
   * survive.
   */
  ligatures?: [string, string][];
}

export function clean(raw: string, opts: Opts = {}): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");

  const first = opts.from ? lines.findIndex((l) => opts.from!.test(l)) : -1;
  const last = opts.to ? lines.findIndex((l) => opts.to!.test(l)) : -1;
  const body = lines.slice(first >= 0 ? first + 1 : 0, last >= 0 ? last : lines.length);

  const drop = [
    ...(opts.heads ?? []),
    /^\s*\d+\s*$/,              // page numbers, and the dingbat ornaments that share their glyphs
    /^\s*[!*§¶•]\s*$/,          // a scene break, set as a single centered mark
  ];
  const kept = body.filter((l) => l.trim() && !drop.some((p) => p.test(l)));

  /**
   * Paragraphs, rebuilt from the indentation the typesetter used.
   *
   * Justified body text carries no blank lines between paragraphs — the break
   * is an indent on the first line and nothing else. Flush-left lines are
   * continuations of the paragraph above and get joined back onto it.
   */
  const paras: string[] = [];
  let cur: string[] = [];
  for (const line of kept) {
    const indent = line.length - line.trimStart().length;
    if (indent >= 2 && cur.length > 0) {
      paras.push(cur.join(" "));
      cur = [];
    }
    cur.push(line.trim());
  }
  if (cur.length > 0) paras.push(cur.join(" "));

  let text = paras.join("\n\n");
  for (const [wrong, right] of opts.ligatures ?? []) {
    text = text.replace(new RegExp(`${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[a-z])`, "g"), right);
  }
  // A drop cap sits apart from the rest of its own word.
  text = text.replace(/^([A-Z])\s{2,}(?=[a-z])/gm, "$1");
  return text.replace(/[ \t]+/g, " ");
}

interface Book extends Opts {
  slug: string;
  author: string;
  title: string;
  year: number;
  kind: string;
}

/**
 * One profile per book, because typesetting is per book.
 *
 * There is no general way to tell a running head from a line of prose — it
 * depends on what the designer put there — so each book gets its own patterns
 * rather than a clever guess that fails silently on the next one. Adding a book
 * means adding an entry here and reading `--inspect` before believing it.
 */
const BOOKS: Book[] = [
  {
    slug: "toothless",
    author: "J. P. Moore",
    title: "Toothless",
    year: 2010,
    kind: "Fantasy",
    from: /^\s*cha.?.?ter\s+[ivxl]+\s*$/i,
    to: /^\s*abou.?\s+.?he\s+au.?hor/i,
    heads: [
      /^\s*\d+\s*\|\s*J\.?\s?P\.?\s?Moore\s*$/i,
      /^\s*Too.?hless\s*\|\s*\d+\s*$/i,
      /^\s*cha.?.?ter\s+[ivxl]+\s*$/i,
      /^\s*book\s+[ivxl]+\s*:/i,
      /^\s*[a-z][a-z\s,'\u2019]{0,38}\s*$/, // setting lines: "france, 1180 ad"
    ],
    ligatures: [["!", "Th"]],
  },
];

const [, , slug, path, ...rest] = process.argv;
const book = BOOKS.find((b) => b.slug === slug);
if (!book || !path) {
  console.error(`usage: measure-book.ts <${BOOKS.map((b) => b.slug).join("|")}> <book.pdf|book.txt> [--inspect]`);
  process.exit(1);
}

const raw = path.endsWith(".pdf")
  ? execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  : readFileSync(path, "utf8");

const text = clean(raw, book);

if (rest.includes("--inspect")) {
  const paras = text.split("\n\n");
  console.log(`paragraphs ${paras.length}, words ${text.split(/\s+/).length}\n`);
  console.log("--- first ---\n" + paras.slice(0, 3).join("\n\n"));
  console.log("\n--- last ---\n" + paras.slice(-2).join("\n\n"));
  process.exit(0);
}

const m = measure(text);
if (m.words < 9000) {
  console.error(`only ${m.words} words came out — check the cleanup with --inspect`);
  process.exit(1);
}

const features: Record<string, number> = {};
for (const key of KEEP) {
  const value = m.overall[key];
  if (value !== undefined) features[key] = Math.round(value * 1e4) / 1e4;
}

const target = new URL("../packages/shared/src/reference-local.ts", import.meta.url);
const held: Record<string, unknown>[] = existsSync(target)
  ? JSON.parse(readFileSync(target, "utf8").slice(readFileSync(target, "utf8").indexOf("[")).replace(/;\s*$/, ""))
  : [];

const entry = {
  author: book.author,
  title: book.title,
  year: book.year,
  kind: book.kind,
  words: m.words,
  dialogueShare: Math.round(m.dialogueShare * 1e4) / 1e4,
  features,
};
const next = [...held.filter((h) => h["title"] !== book.title), entry].sort((a, b) =>
  String(a["title"]).localeCompare(String(b["title"])),
);

const HEADER = `/**
 * Novels measured from a copy held locally, rather than fetched from Gutenberg.
 *
 * Generated by \`tools/measure-book.ts\` — do not edit by hand. Kept in its own
 * file because the Gutenberg harvester rewrites \`reference-data.ts\` wholesale
 * and would otherwise delete these on its next run.
 *
 * Only the numbers, as everywhere else. No prose from these books is stored or
 * shipped, which is what makes it reasonable to measure books still in
 * copyright: what is kept here could not reconstruct a sentence of one.
 *
 * These sit alongside the public-domain novels and are treated no differently.
 */

import type { ReferenceWork } from "./reference-data.js";

export const LOCAL_WORKS: ReferenceWork[] = `;

writeFileSync(target, HEADER + JSON.stringify(next, null, 2) + ";\n");
console.log(`${m.words.toLocaleString()} words, ${(m.dialogueShare * 100).toFixed(1)}% spoken`);
console.log(`wrote packages/shared/src/reference-local.ts (${next.length} book${next.length === 1 ? "" : "s"})`);
