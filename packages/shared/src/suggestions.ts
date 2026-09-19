import { normalizeProse } from "./prose.js";
import type { ProseDoc, ProseMark, ProseText } from "./prose.js";

/**
 * Proofreading: changes proposed in the prose itself, for accepting or rejecting.
 *
 * Until a suggestion is accepted it is not part of the manuscript. That is the
 * rule every function here serves, and it is what makes the mode safe to leave
 * switched on: the word count, the goals, the writing history, the exports and
 * the model's reading of the book all see the prose as it stands, and none of
 * them can be moved by a change nobody has agreed to yet.
 */

const markOf = (run: ProseText, type: "ins" | "del"): ProseMark | undefined =>
  run.marks?.find((m) => m.type === type);

export const isInserted = (run: ProseText): boolean => markOf(run, "ins") !== undefined;
export const isDeleted = (run: ProseText): boolean => markOf(run, "del") !== undefined;

/** A run with one suggestion mark taken off, and everything else left as it was. */
function without(run: ProseText, type: "ins" | "del"): ProseText {
  const marks = (run.marks ?? []).filter((m) => m.type !== type);
  return marks.length ? { ...run, marks } : { type: "text", text: run.text };
}

/** The same document with each run passed through `keep`, which can drop it. */
function mapRuns(doc: ProseDoc, keep: (run: ProseText) => ProseText | null): ProseDoc {
  return normalizeProse({
    type: "doc",
    content: doc.content.map((paragraph) => ({
      ...paragraph,
      content: (paragraph.content ?? []).map(keep).filter((r): r is ProseText => r !== null),
    })),
  });
}

/**
 * The prose as it stands, with every pending suggestion left out.
 *
 * Suggested insertions are not there yet; suggested deletions still are. This
 * is the manuscript for every purpose except showing the suggestions: what is
 * counted, exported, measured and read.
 */
export function baseDoc(doc: ProseDoc): ProseDoc {
  return mapRuns(doc, (run) => (isInserted(run) ? null : isDeleted(run) ? without(run, "del") : run));
}

/** The prose as it would be with every suggestion accepted. */
export function acceptedDoc(doc: ProseDoc): ProseDoc {
  return mapRuns(doc, (run) => (isDeleted(run) ? null : isInserted(run) ? without(run, "ins") : run));
}

/**
 * Settle one suggestion.
 *
 * Accepting keeps what it inserted and removes what it deleted; rejecting does
 * the opposite. A replacement is one suggestion with both halves, so it is
 * always settled whole — accepting the new word without removing the old one
 * would leave both on the page.
 */
export function resolveSuggestion(doc: ProseDoc, id: string, accept: boolean): ProseDoc {
  return mapRuns(doc, (run) => {
    if (markOf(run, "ins")?.id === id) return accept ? without(run, "ins") : null;
    if (markOf(run, "del")?.id === id) return accept ? null : without(run, "del");
    return run;
  });
}

/** Settle every suggestion in a document the same way. */
export function resolveAll(doc: ProseDoc, accept: boolean): ProseDoc {
  return accept ? acceptedDoc(doc) : baseDoc(doc);
}

export function hasSuggestions(doc: ProseDoc): boolean {
  return doc.content.some((p) => (p.content ?? []).some((run) => isInserted(run) || isDeleted(run)));
}

/** One pending change, as a card in the margin describes it. */
export interface Suggestion {
  id: string;
  /** When it was suggested, if the time was recorded. */
  at: string | null;
  kind: "add" | "delete" | "replace";
  /** What it would put in. Empty for a pure deletion. */
  added: string;
  /** What it would take out. Empty for a pure addition. */
  removed: string;
  /** The paragraph it starts in, for ordering and for finding it on the page. */
  paragraph: number;
}

/**
 * Every pending suggestion, in the order it first appears.
 *
 * Gathered by id, because one suggestion can be several runs — an insertion that
 * crosses into italics, a deletion that spans two paragraphs — and the card is
 * for the change, not for each piece of it.
 */
export function suggestionsIn(doc: ProseDoc): Suggestion[] {
  const byId = new Map<string, Suggestion>();
  doc.content.forEach((paragraph, index) => {
    for (const run of paragraph.content ?? []) {
      for (const type of ["ins", "del"] as const) {
        const mark = markOf(run, type);
        if (!mark?.id) continue;
        const held =
          byId.get(mark.id) ??
          ({ id: mark.id, at: mark.at ?? null, kind: "add", added: "", removed: "", paragraph: index } as Suggestion);
        if (type === "ins") held.added += run.text;
        else held.removed += run.text;
        byId.set(mark.id, held);
      }
    }
  });
  for (const held of byId.values()) {
    held.kind = held.added && held.removed ? "replace" : held.added ? "add" : "delete";
  }
  return [...byId.values()];
}
