import { normalizeProse } from "./prose.js";
import type { ProseDoc, ProseMark, ProseText } from "./prose.js";
import { foldForSearch } from "./spelling.js";
import { baseDoc, hasSuggestions } from "./suggestions.js";

/**
 * Find and replace, on the document rather than on its text.
 *
 * Find matches plain text, which is enough to say where a word is. Replacing it
 * has to happen in the document the text was drawn from — paragraphs of runs,
 * some of them italic — or every replacement would strip the emphasis from the
 * paragraph it touched. So a match is found in the text and then carried back
 * into the runs.
 *
 * The rule the whole module exists to keep: what Replace touches is exactly
 * what Find counted. "Replace this one" means the occurrence the writer is
 * looking at, and a replacement that lands one occurrence away from the
 * highlighted one is worse than no replace at all.
 */

/** Characters folded for matching, with where each came from in the original. */
interface Mapped {
  text: string;
  /** For each folded character, the index of its source in the original. */
  from: number[];
  /** And the index just past its source, so a partial match covers it whole. */
  to: number[];
}

const DASH = "-";

/**
 * The paragraph as Find sees it, mapped back to the paragraph as stored.
 *
 * Find runs over the text as it is shown, which in a format that smartens
 * punctuation is not the text as it is stored. Smartening does four things:
 * three hyphens become an en dash, two become an em dash, three periods become
 * an ellipsis, and straight quotes turn. Folding already undoes the quotes and
 * the ellipsis — both come back character for character — but a dash folds to
 * one hyphen, where the stored text still has two or three. Left alone, a query
 * containing a hyphen would count differently here than in Find, and "replace
 * this one" would miss.
 *
 * So the dash passes are repeated here, exactly as smartening runs them: the
 * triples first, then any pair with no hyphen either side, reading the result
 * of the first pass the way the regex's lookbehind does.
 */
export function foldForReplace(text: string, smartens: boolean): Mapped {
  // The stored characters, with any smartened dash collapsed to one.
  let units: { ch: string; from: number; to: number }[] = [];
  for (let i = 0; i < text.length; ) {
    if (smartens && text.startsWith("---", i)) {
      units.push({ ch: "–", from: i, to: i + 3 });
      i += 3;
      continue;
    }
    const code = text.codePointAt(i)!;
    const ch = String.fromCodePoint(code);
    units.push({ ch, from: i, to: i + ch.length });
    i += ch.length;
  }

  if (smartens) {
    const paired: typeof units = [];
    for (let k = 0; k < units.length; ) {
      const here = units[k]!;
      if (
        here.ch === DASH &&
        units[k + 1]?.ch === DASH &&
        units[k - 1]?.ch !== DASH &&
        units[k + 2]?.ch !== DASH
      ) {
        paired.push({ ch: "—", from: here.from, to: units[k + 1]!.to });
        k += 2;
        continue;
      }
      paired.push(here);
      k += 1;
    }
    units = paired;
  }

  let out = "";
  const from: number[] = [];
  const to: number[] = [];
  for (const unit of units) {
    const folded = foldForSearch(unit.ch);
    // Per code unit, not per character: `indexOf` counts code units, so a
    // character outside the basic plane is two positions in the folded text
    // and must be two entries here, or every position after it is off by one.
    for (let u = 0; u < folded.length; u += 1) {
      from.push(unit.from);
      to.push(unit.to);
    }
    out += folded;
  }
  return { text: out, from, to };
}

/** One occurrence, in stored coordinates within a paragraph. */
export interface Occurrence {
  paragraph: number;
  start: number;
  end: number;
}

/** A paragraph's text, as its runs spell it. */
const paragraphText = (runs: ProseText[] | undefined) => (runs ?? []).map((r) => r.text).join("");

/**
 * Every occurrence in a document, in reading order.
 *
 * Scanned the way Find scans — left to right, not overlapping, a paragraph at a
 * time — so the nth here is the nth Find counted in this section. No match can
 * cross a paragraph, because a query is typed on one line.
 */
export function occurrencesIn(doc: ProseDoc, query: string, smartens: boolean): Occurrence[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return [];
  const out: Occurrence[] = [];

  // Find searches the text as it stands, so pending suggestions are counted as
  // they are counted everywhere else: insertions not yet there, deletions
  // still there.
  baseDoc(doc).content.forEach((paragraph, index) => {
    const text = paragraphText(paragraph.content);
    const mapped = foldForReplace(text, smartens);
    let from = 0;
    for (;;) {
      const at = mapped.text.indexOf(needle, from);
      if (at === -1) break;
      out.push({
        paragraph: index,
        start: mapped.from[at]!,
        end: mapped.to[at + needle.length - 1]!,
      });
      from = at + needle.length;
    }
  });
  return out;
}

/**
 * The replacement, in the case of what it replaces — when it has none of its own.
 *
 * Find ignores case, so "the captain" finds "The captain" at the head of a
 * sentence, and replacing it verbatim with "the commander" would leave a
 * lower-case letter opening a sentence in the manuscript. So a replacement
 * typed entirely in lower case takes the shape of each match: capitalized where
 * it was capitalized, shouted where it was shouted.
 *
 * Typed with any capital of its own, it is used exactly as typed. A writer who
 * types "McAllister" means that spelling everywhere, including where the old
 * name happened to sit at the start of a sentence.
 */
export function inCaseOf(matched: string, replacement: string): string {
  if (replacement !== replacement.toLowerCase()) return replacement;
  const letters = matched.replace(/[^\p{L}]/gu, "");
  if (!letters) return replacement;
  if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  const first = letters[0]!;
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    const lead = replacement.search(/\p{L}/u);
    if (lead === -1) return replacement;
    return replacement.slice(0, lead) + replacement[lead]!.toUpperCase() + replacement.slice(lead + 1);
  }
  return replacement;
}

/** A character of a paragraph, with the marks it was written in. */
interface Cell {
  ch: string;
  marks: ProseMark[] | undefined;
}

/**
 * Replace some or all occurrences in one document.
 *
 * `which` is the occurrence's position among this document's matches, as Find
 * numbers them, or "all".
 *
 * The replacement takes the marks of the character it starts on. A match that
 * runs out of italics and into roman has no one right answer, and the start is
 * the one a writer would guess: replacing an italicized title keeps it
 * italicized.
 *
 * Returned normalized, so adjacent runs with the same marks are fused rather
 * than left as a seam where the replacement went in.
 */
export function replaceInDoc(
  doc: ProseDoc,
  query: string,
  replacement: string,
  smartens: boolean,
  which: number | "all",
): { doc: ProseDoc; replaced: number; held?: boolean } {
  /**
   * Not in a section with suggestions waiting.
   *
   * A match there can straddle a suggested deletion, run into a suggested
   * insertion, or sit inside text already proposed for removal, and there is
   * no replacement that is right in all three. So the section is left alone
   * and reported, and its suggestions can be settled first.
   */
  if (hasSuggestions(doc)) return { doc, replaced: 0, held: true };
  const found = occurrencesIn(doc, query, smartens);
  const chosen = which === "all" ? found : found[which] ? [found[which]!] : [];
  if (chosen.length === 0) return { doc, replaced: 0 };

  const byParagraph = new Map<number, Occurrence[]>();
  for (const hit of chosen) {
    const held = byParagraph.get(hit.paragraph) ?? [];
    held.push(hit);
    byParagraph.set(hit.paragraph, held);
  }

  const content = doc.content.map((paragraph, index) => {
    const hits = byParagraph.get(index);
    if (!hits) return paragraph;

    const cells: Cell[] = [];
    for (const run of paragraph.content ?? []) {
      for (const ch of run.text) cells.push({ ch, marks: run.marks });
    }
    // Cells are code points; the occurrence is in code units. Map one to the other.
    const unitToCell: number[] = [];
    cells.forEach((cell, c) => {
      for (let u = 0; u < cell.ch.length; u += 1) unitToCell.push(c);
    });
    unitToCell.push(cells.length);
    const text = paragraphText(paragraph.content);

    // Right to left, so earlier positions stay where they were.
    for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
      const first = unitToCell[hit.start]!;
      const last = unitToCell[hit.end]!;
      const marks = cells[first]?.marks;
      const word = inCaseOf(text.slice(hit.start, hit.end), replacement);
      const fresh: Cell[] = [...word].map((ch) => ({ ch, marks }));
      cells.splice(first, last - first, ...fresh);
    }

    // A run a character, fused back together by normalizing below.
    const runs: ProseText[] = cells.map((cell) =>
      cell.marks?.length
        ? { type: "text", text: cell.ch, marks: cell.marks }
        : { type: "text", text: cell.ch },
    );
    return { ...paragraph, content: runs };
  });

  return { doc: normalizeProse({ type: "doc", content }), replaced: chosen.length };
}
