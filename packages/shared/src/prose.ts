/**
 * A block's prose.
 *
 * Paragraphs of runs, where a run carries the only two marks that belong to the
 * words themselves: bold and italic. Everything else about how prose looks —
 * face, size, spacing, indent, alignment — is decided by the block's format and
 * the manuscript's typography, not typed into the text. A writer who could set
 * the line spacing of one paragraph would eventually have a manuscript no
 * format could fix.
 *
 * The shape is ProseMirror's, because that is what the importer already writes
 * and what the server's word counter already walks.
 */

export type ProseMarkType = "strong" | "em" | "underline";

/**
 * A change proposed rather than made: text suggested in, or suggested out.
 *
 * Marks on the runs, like emphasis, because that is what they are — a property
 * of particular words — and because it keeps a suggestion inside the one
 * document the editor, the reading view and the export already share, rather
 * than in a second store that could fall out of step with the prose.
 */
export type SuggestionMarkType = "ins" | "del" | "fmt";

export interface ProseMark {
  type: ProseMarkType | SuggestionMarkType;
  /**
   * Which suggestion a run belongs to. An insertion and a deletion made in one
   * act — typing over a selection — share an id, and that pair is what a
   * replacement is.
   */
  id?: string;
  /** When it was suggested, as an ISO timestamp. */
  at?: string;
  /**
   * A formatting suggestion's other half: the emphasis these words had before.
   *
   * The run carries the formatting proposed, so it reads as it would once
   * accepted; this is what it goes back to if rejected, and what it still is
   * for every purpose that reads the manuscript as it stands.
   */
  was?: ProseMarkType[];
}

/** A paragraph break proposed or proposed for removal, as a suggestion carries it. */
export interface BreakSuggestion {
  id: string;
  at?: string;
}

export interface ProseText {
  type: "text";
  text: string;
  marks?: ProseMark[];
}

export interface ProseParagraph {
  type: "paragraph";
  content?: ProseText[];
  /**
   * An extract set apart from the prose around it — a letter, an epigraph, a
   * passage being quoted.
   *
   * A property of the paragraph rather than a mark on its words, because that
   * is what it is: the whole line is set differently, and half a blockquote is
   * not a thing. How far it is inset and how it is spaced belong to the format,
   * as with every other measurement; this only records that the paragraph is
   * one.
   */
  blockquote?: boolean;
  /**
   * The break before this paragraph is a suggestion: Enter, pressed while
   * proofreading. Until accepted, this paragraph is still the end of the one
   * above it.
   */
  split?: BreakSuggestion;
  /**
   * The break before this paragraph is proposed for removal: a backspace at its
   * start, while proofreading. Until accepted, the two stay apart.
   */
  join?: BreakSuggestion;
}

export interface ProseDoc {
  type: "doc";
  content: ProseParagraph[];
}

/** A break suggestion, if the value is one. Without an id it could not be settled. */
function readBreak(value: unknown): BreakSuggestion | undefined {
  if (!value || typeof value !== "object") return undefined;
  const held = value as { id?: unknown; at?: unknown };
  if (typeof held.id !== "string") return undefined;
  return { id: held.id, ...(typeof held.at === "string" ? { at: held.at } : {}) };
}

/** Reads an unknown blob as a doc, or null if it isn't one. */
export function asProseDoc(value: unknown): ProseDoc | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as { type?: unknown; content?: unknown };
  if (doc.type !== "doc" || !Array.isArray(doc.content)) return null;

  const paragraphs: ProseParagraph[] = [];
  for (const node of doc.content) {
    if (!node || typeof node !== "object") continue;
    const para = node as { type?: unknown; content?: unknown };
    if (para.type !== "paragraph") continue;
    const runs: ProseText[] = [];
    if (Array.isArray(para.content)) {
      for (const child of para.content) {
        if (!child || typeof child !== "object") continue;
        const run = child as { type?: unknown; text?: unknown; marks?: unknown };
        if (run.type !== "text" || typeof run.text !== "string") continue;
        const marks: ProseMark[] = [];
        if (Array.isArray(run.marks)) {
          for (const mark of run.marks) {
            const held = mark as { type?: unknown; id?: unknown; at?: unknown } | null;
            const t = held?.type;
            if (t === "strong" || t === "em" || t === "underline") marks.push({ type: t });
            // A suggestion without an id cannot be accepted or rejected, so it
            // is not kept as one — the words stay, as ordinary text.
            else if ((t === "ins" || t === "del" || t === "fmt") && typeof held?.id === "string") {
              const was = (held as { was?: unknown }).was;
              marks.push({
                type: t,
                id: held.id,
                ...(typeof held.at === "string" ? { at: held.at } : {}),
                ...(t === "fmt"
                  ? {
                      was: Array.isArray(was)
                        ? was.filter((w): w is ProseMarkType => w === "strong" || w === "em" || w === "underline")
                        : [],
                    }
                  : {}),
              });
            }
          }
        }
        runs.push(marks.length ? { type: "text", text: run.text, marks } : { type: "text", text: run.text });
      }
    }
    const quoted = (para as { blockquote?: unknown }).blockquote === true;
    const split = readBreak((para as { split?: unknown }).split);
    const join = readBreak((para as { join?: unknown }).join);
    paragraphs.push({
      type: "paragraph",
      ...(runs.length ? { content: runs } : {}),
      ...(quoted ? { blockquote: true } : {}),
      ...(split ? { split } : {}),
      ...(join ? { join } : {}),
    });
  }
  return { type: "doc", content: paragraphs };
}

/** Plain paragraphs, as an import or a paste produces. */
export function proseFromParagraphs(paragraphs: readonly string[]): ProseDoc {
  return {
    type: "doc",
    content: paragraphs.map((text) =>
      text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" },
    ),
  };
}

/** The runs of each paragraph, which is what a renderer walks. */
export function proseParagraphs(doc: ProseDoc): ProseText[][] {
  return doc.content.map((p) => p.content ?? []);
}

/** Blank-line-separated text, the form the rest of the app searches and counts. */
export function proseToText(doc: ProseDoc): string {
  return proseParagraphs(doc)
    .map((runs) => runs.map((r) => r.text).join(""))
    .join("\n\n");
}

export function hasMark(run: ProseText, type: ProseMarkType | SuggestionMarkType): boolean {
  return (run.marks ?? []).some((m) => m.type === type);
}

/** Every mark a run can carry, as a comparable key. */
const MARK_TYPES: ProseMarkType[] = ["strong", "em", "underline"];

/**
 * Two runs fuse only if they would read the same and belong to the same
 * suggestion. Emphasis alone was the key; with suggestions in it, two separate
 * insertions sitting side by side would have fused into one and been accepted
 * or rejected together.
 */
const markKey = (run: ProseText): string => {
  const shape = MARK_TYPES.map((type) => (hasMark(run, type) ? "1" : "0")).join("");
  const ins = run.marks?.find((m) => m.type === "ins")?.id ?? "";
  const del = run.marks?.find((m) => m.type === "del")?.id ?? "";
  const fmt = run.marks?.find((m) => m.type === "fmt");
  return `${shape}|${ins}|${del}|${fmt ? `${fmt.id}:${[...(fmt.was ?? [])].sort().join(",")}` : ""}`;
};

/** Drops empty runs and fuses neighbors that carry the same marks. */
export function normalizeProse(doc: ProseDoc): ProseDoc {
  return {
    type: "doc",
    content: doc.content.map((para) => {
      const runs: ProseText[] = [];
      for (const run of para.content ?? []) {
        if (!run.text) continue;
        const last = runs[runs.length - 1];
        if (last && markKey(last) === markKey(run)) {
          last.text += run.text;
          continue;
        }
        runs.push({ ...run, marks: run.marks ? [...run.marks] : undefined });
      }
      return {
        type: "paragraph",
        ...(runs.length ? { content: runs } : {}),
        ...(para.blockquote ? { blockquote: true } : {}),
        ...(para.split ? { split: para.split } : {}),
        ...(para.join ? { join: para.join } : {}),
      };
    }),
  };
}
