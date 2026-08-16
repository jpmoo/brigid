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

export interface ProseMark {
  type: ProseMarkType;
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
}

export interface ProseDoc {
  type: "doc";
  content: ProseParagraph[];
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
            const t = (mark as { type?: unknown } | null)?.type;
            if (t === "strong" || t === "em" || t === "underline") marks.push({ type: t });
          }
        }
        runs.push(marks.length ? { type: "text", text: run.text, marks } : { type: "text", text: run.text });
      }
    }
    const quoted = (para as { blockquote?: unknown }).blockquote === true;
    paragraphs.push({
      type: "paragraph",
      ...(runs.length ? { content: runs } : {}),
      ...(quoted ? { blockquote: true } : {}),
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

export function hasMark(run: ProseText, type: ProseMarkType): boolean {
  return (run.marks ?? []).some((m) => m.type === type);
}

/** Every mark a run can carry, as a comparable key. */
const MARK_TYPES: ProseMarkType[] = ["strong", "em", "underline"];

const markKey = (run: ProseText): string =>
  MARK_TYPES.map((type) => (hasMark(run, type) ? "1" : "0")).join("");

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
      };
    }),
  };
}
