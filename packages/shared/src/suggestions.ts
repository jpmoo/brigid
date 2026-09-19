import { normalizeProse } from "./prose.js";
import type { ProseDoc, ProseMark, ProseMarkType, ProseParagraph, ProseText } from "./prose.js";

/**
 * Proofreading: changes proposed in the prose itself, for accepting or rejecting.
 *
 * Until a suggestion is accepted it is not part of the manuscript. That is the
 * rule every function here serves, and it is what makes the mode safe to leave
 * switched on: the word count, the goals, the writing history, the exports and
 * the model's reading of the book all see the prose as it stands, and none of
 * them can be moved by a change nobody has agreed to yet.
 *
 * Four kinds of change: words added, words removed, a paragraph break added or
 * removed, and emphasis changed. The first two are marks on runs; a break
 * belongs to the paragraph after it; a change of emphasis is a mark on the runs
 * carrying what their emphasis was before.
 */

const EMPHASIS: ProseMarkType[] = ["strong", "em", "underline"];

const markOf = (run: ProseText, type: "ins" | "del" | "fmt"): ProseMark | undefined =>
  run.marks?.find((m) => m.type === type);

export const isInserted = (run: ProseText): boolean => markOf(run, "ins") !== undefined;
export const isDeleted = (run: ProseText): boolean => markOf(run, "del") !== undefined;

/** A run's emphasis, and only its emphasis. */
const emphasisOf = (marks: ProseMark[] | undefined): ProseMarkType[] =>
  EMPHASIS.filter((type) => (marks ?? []).some((m) => m.type === type));

const sameEmphasis = (a: ProseMarkType[], b: ProseMarkType[]) =>
  a.length === b.length && a.every((type) => b.includes(type));

/** A run rebuilt from its parts, with no empty marks list. */
function runOf(text: string, marks: ProseMark[]): ProseText {
  return marks.length ? { type: "text", text, marks } : { type: "text", text };
}

/** A run with one suggestion mark taken off, and everything else left as it was. */
function without(run: ProseText, type: "ins" | "del" | "fmt"): ProseText {
  return runOf(run.text, (run.marks ?? []).filter((m) => m.type !== type));
}

/** A run with a formatting suggestion undone: its emphasis put back as it was. */
function reverted(run: ProseText): ProseText {
  const fmt = markOf(run, "fmt");
  if (!fmt) return run;
  const others = (run.marks ?? []).filter((m) => m.type !== "fmt" && !EMPHASIS.includes(m.type as ProseMarkType));
  return runOf(run.text, [...(fmt.was ?? []).map((type) => ({ type })), ...others]);
}

/** What happens to one paragraph break when a document is settled. */
type BreakFate = "merge" | "keep";

/**
 * The document with each run passed through `keep`, which can drop it, and each
 * suggested break either kept or merged away.
 *
 * Merging folds a paragraph into the one before it — which is what a break
 * that was never there, or a break taken out, amounts to.
 */
function settle(
  doc: ProseDoc,
  keep: (run: ProseText) => ProseText | null,
  fate: (paragraph: ProseParagraph) => { split?: BreakFate; join?: BreakFate },
): ProseDoc {
  const out: ProseParagraph[] = [];
  for (const paragraph of doc.content) {
    const runs = (paragraph.content ?? []).map(keep).filter((r): r is ProseText => r !== null);
    const decided = fate(paragraph);
    const merge =
      (paragraph.split && decided.split === "merge") || (paragraph.join && decided.join === "merge");
    const previous = out[out.length - 1];
    if (merge && previous) {
      previous.content = [...(previous.content ?? []), ...runs];
      continue;
    }
    const next: ProseParagraph = { type: "paragraph", content: runs };
    if (paragraph.blockquote) next.blockquote = true;
    if (paragraph.split && decided.split === undefined) next.split = paragraph.split;
    if (paragraph.join && decided.join === undefined) next.join = paragraph.join;
    out.push(next);
  }
  return normalizeProse({ type: "doc", content: out });
}

/**
 * The prose as it stands, with every pending suggestion left out.
 *
 * Suggested words are not there yet; struck words still are; a suggested break
 * has not split anything; a break proposed for removal still stands; suggested
 * emphasis has not been applied. This is the manuscript for every purpose except
 * showing the suggestions: what is counted, exported, measured and read.
 */
export function baseDoc(doc: ProseDoc): ProseDoc {
  return settle(
    doc,
    (run) => (isInserted(run) ? null : reverted(isDeleted(run) ? without(run, "del") : run)),
    () => ({ split: "merge", join: "keep" }),
  );
}

/** The prose as it would be with every suggestion accepted. */
export function acceptedDoc(doc: ProseDoc): ProseDoc {
  return settle(
    doc,
    (run) => (isDeleted(run) ? null : without(without(run, "ins"), "fmt")),
    () => ({ split: "keep", join: "merge" }),
  );
}

/**
 * Settle one suggestion.
 *
 * Accepting keeps what it proposed and removes what it would remove; rejecting
 * does the opposite. All of a suggestion is settled at once — a replacement's
 * two halves, words typed on either side of a break along with the break — so
 * accepting can never keep the new word and leave the old one on the page.
 */
export function resolveSuggestion(doc: ProseDoc, id: string, accept: boolean): ProseDoc {
  return settle(
    doc,
    (run) => {
      if (markOf(run, "ins")?.id === id) return accept ? without(run, "ins") : null;
      if (markOf(run, "del")?.id === id) return accept ? null : without(run, "del");
      if (markOf(run, "fmt")?.id === id) return accept ? without(run, "fmt") : reverted(run);
      return run;
    },
    (paragraph) => ({
      ...(paragraph.split?.id === id ? { split: accept ? ("keep" as const) : ("merge" as const) } : {}),
      ...(paragraph.join?.id === id ? { join: accept ? ("merge" as const) : ("keep" as const) } : {}),
    }),
  );
}

/** Settle every suggestion in a document the same way. */
export function resolveAll(doc: ProseDoc, accept: boolean): ProseDoc {
  return accept ? acceptedDoc(doc) : baseDoc(doc);
}

export function hasSuggestions(doc: ProseDoc): boolean {
  return doc.content.some(
    (p) =>
      p.split !== undefined ||
      p.join !== undefined ||
      (p.content ?? []).some((run) => isInserted(run) || isDeleted(run) || markOf(run, "fmt") !== undefined),
  );
}

/** One pending change, as a card in the margin describes it. */
export interface Suggestion {
  id: string;
  /** When it was suggested, if the time was recorded. */
  at: string | null;
  kind: "add" | "delete" | "replace" | "format";
  /** What it would put in, with a pilcrow where it adds a break. */
  added: string;
  /** What it would take out, with a pilcrow where it removes a break. */
  removed: string;
  /** For a change of emphasis, what it turns on and what it turns off. */
  format?: { added: ProseMarkType[]; removed: ProseMarkType[] };
  /** The paragraph it starts in, for ordering and for finding it on the page. */
  paragraph: number;
}

/** A pilcrow stands for a paragraph break wherever a suggestion's text is shown. */
export const PILCROW = "¶";

/**
 * Every pending suggestion, in the order it first appears.
 *
 * Gathered by id, because one suggestion can be several pieces — an insertion
 * that crosses into italics, a deletion that spans two paragraphs, a passage
 * typed across a new break — and the card is for the change, not for each piece
 * of it.
 */
export function suggestionsIn(doc: ProseDoc): Suggestion[] {
  const byId = new Map<string, Suggestion>();
  const entry = (id: string, at: string | undefined, paragraph: number): Suggestion => {
    const held =
      byId.get(id) ??
      ({ id, at: at ?? null, kind: "add", added: "", removed: "", paragraph } as Suggestion);
    byId.set(id, held);
    return held;
  };

  doc.content.forEach((paragraph, index) => {
    if (paragraph.split) entry(paragraph.split.id, paragraph.split.at, index).added += PILCROW;
    if (paragraph.join) entry(paragraph.join.id, paragraph.join.at, index).removed += PILCROW;

    for (const run of paragraph.content ?? []) {
      const ins = markOf(run, "ins");
      if (ins?.id) entry(ins.id, ins.at, index).added += run.text;
      const del = markOf(run, "del");
      if (del?.id) entry(del.id, del.at, index).removed += run.text;
      const fmt = markOf(run, "fmt");
      if (fmt?.id) {
        const held = entry(fmt.id, fmt.at, index);
        const now = emphasisOf(run.marks);
        const was = fmt.was ?? [];
        const format = held.format ?? { added: [], removed: [] };
        for (const type of now) if (!was.includes(type) && !format.added.includes(type)) format.added.push(type);
        for (const type of was) if (!now.includes(type) && !format.removed.includes(type)) format.removed.push(type);
        held.format = format;
        held.added += run.text;
      }
    }
  });

  for (const held of byId.values()) {
    held.kind = held.format
      ? "format"
      : held.added && held.removed
        ? "replace"
        : held.added
          ? "add"
          : "delete";
  }
  return [...byId.values()];
}

/** A character with the marks it carries, for comparing two versions letter by letter. */
interface Cell {
  ch: string;
  marks: ProseMark[];
}

const cellsOf = (paragraph: ProseParagraph): Cell[] =>
  (paragraph.content ?? []).flatMap((run) => [...run.text].map((ch) => ({ ch, marks: run.marks ?? [] })));

/**
 * Emphasis changed while proofreading, recorded as a suggestion.
 *
 * `before` and `after` are the same words with different emphasis — the prose
 * either side of a click on Bold. Every letter whose emphasis changed gets a
 * formatting suggestion remembering what it was, so the change shows as it
 * would be accepted and can still be taken back whole.
 *
 * Letters inside a suggested insertion are simply formatted: the words are
 * themselves a proposal, and a proposal can be revised freely. A letter
 * formatted back to what it originally was loses its suggestion rather than
 * gaining a second one. A letter changed twice stays one suggestion.
 *
 * If the two versions are not the same words — which formatting should never
 * produce — the change is refused rather than let through unrecorded.
 */
export function proposeFormatting(before: ProseDoc, after: ProseDoc, stamp: { id: string; at: string }): ProseDoc {
  if (before.content.length !== after.content.length) return before;

  const paragraphs: ProseParagraph[] = [];
  for (let p = 0; p < before.content.length; p += 1) {
    const was = before.content[p]!;
    const now = after.content[p]!;
    const old = cellsOf(was);
    const next = cellsOf(now);
    if (old.map((c) => c.ch).join("") !== next.map((c) => c.ch).join("")) return before;

    const runs: ProseText[] = old.map((cell, k) => {
      const changed = next[k]!;
      const oldEmphasis = emphasisOf(cell.marks);
      const newEmphasis = emphasisOf(changed.marks);
      if (sameEmphasis(oldEmphasis, newEmphasis)) return runOf(cell.ch, cell.marks);

      const suggestionMarks = cell.marks.filter((m) => m.type === "ins" || m.type === "del");
      if (suggestionMarks.some((m) => m.type === "ins")) {
        return runOf(cell.ch, [...newEmphasis.map((type) => ({ type })), ...suggestionMarks]);
      }

      const prior = cell.marks.find((m) => m.type === "fmt");
      const original = prior?.was ?? oldEmphasis;
      if (sameEmphasis(original, newEmphasis)) {
        return runOf(cell.ch, [...newEmphasis.map((type) => ({ type })), ...suggestionMarks]);
      }
      const fmt: ProseMark = {
        type: "fmt",
        id: prior?.id ?? stamp.id,
        at: prior?.at ?? stamp.at,
        was: original,
      };
      return runOf(cell.ch, [...newEmphasis.map((type) => ({ type })), ...suggestionMarks, fmt]);
    });

    paragraphs.push({ ...was, content: runs });
  }
  return normalizeProse({ type: "doc", content: paragraphs });
}
