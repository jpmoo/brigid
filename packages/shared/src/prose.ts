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

export type ProseMarkType = "strong" | "em";

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
            if (t === "strong" || t === "em") marks.push({ type: t });
          }
        }
        runs.push(marks.length ? { type: "text", text: run.text, marks } : { type: "text", text: run.text });
      }
    }
    paragraphs.push(runs.length ? { type: "paragraph", content: runs } : { type: "paragraph" });
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

/** Drops empty runs and fuses neighbours that carry the same marks. */
export function normalizeProse(doc: ProseDoc): ProseDoc {
  return {
    type: "doc",
    content: doc.content.map((para) => {
      const runs: ProseText[] = [];
      for (const run of para.content ?? []) {
        if (!run.text) continue;
        const last = runs[runs.length - 1];
        if (last && hasMark(last, "strong") === hasMark(run, "strong") && hasMark(last, "em") === hasMark(run, "em")) {
          last.text += run.text;
          continue;
        }
        runs.push({ ...run, marks: run.marks ? [...run.marks] : undefined });
      }
      return runs.length ? { type: "paragraph", content: runs } : { type: "paragraph" };
    }),
  };
}
