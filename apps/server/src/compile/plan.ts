import {
  asProseDoc,
  deriveDocument,
  hasMark,
  proseParagraphs,
  smartenText,
} from "@brigid/shared";
import type { DocumentItem, ResolvedSpan, Typography } from "@brigid/shared";

/**
 * What a manuscript becomes on its way out.
 *
 * One flat structure that both the Word writer and the PDF writer walk, so the
 * two files say the same thing. Everything decided here is decided once:
 * neither renderer gets to have its own opinion about a first-line indent.
 */

export interface CompiledRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface CompiledLine {
  runs: CompiledRun[];
  align: "left" | "center" | "right" | "justify";
  fontFamily: string;
  fontSizePt: number;
  /** A multiplier on the font size, as CSS means it. */
  lineHeight: number;
  firstLineIndentIn: number;
  /** Blank space after the line, in multiples of the font size. */
  spaceAfterEm: number;
}

export type CompiledNode = { kind: "line"; line: CompiledLine } | { kind: "pageBreak" };

export interface CompiledManuscript {
  /** The title page and anything else before the writing starts. */
  front: CompiledNode[];
  /** The manuscript proper. Page one is the first page of this. */
  body: CompiledNode[];
  /** Right-hand running head, or null when it isn't wanted. */
  runningHead: { surname: string; shortTitle: string } | null;
}

/** Shunn's manuscript face, when a format has nothing to say about it. */
const FALLBACK_FONT = '"Courier New", Courier, monospace';
const FALLBACK_SIZE = 12;
/** Courier's own line is about 1.125 of its size, so double is 2.25. */
const FALLBACK_LINE_HEIGHT = 2.25;

export interface CompileOptions {
  /** Block ids to include. Everything, when empty. */
  include?: string[];
  runningHeads: boolean;
  /**
   * One word, and required.
   *
   * It goes in the running head and in the filename, and both want something
   * short — a running head is read at a glance across the top of a page, and a
   * filename with a whole title in it is a filename nobody can say out loud.
   * There is no falling back to the real title, because the real title is
   * exactly what is too long.
   */
  shortTitle: string;
}

function runsFrom(spans: ResolvedSpan[]): CompiledRun[] {
  const runs: CompiledRun[] = [];
  for (const span of spans) {
    if (span.lineBreak) {
      runs.push({ text: "\n" });
      continue;
    }
    // A tab in a template is a stop, not a character; a manuscript's only
    // indent is the paragraph's own, so it becomes ordinary spacing.
    const text = span.tab ? "    " : span.text;
    if (!text) continue;
    runs.push({
      // Small caps and all caps have no counterpart in either format that is
      // worth the complication, and both are set by capitalising the text.
      text: span.allCaps || span.smallCaps ? text.toLocaleUpperCase("en") : text,
      ...(span.bold ? { bold: true } : {}),
      ...(span.italic ? { italic: true } : {}),
      ...(span.underline ? { underline: true } : {}),
    });
  }
  return runs;
}

function lineFrom(
  runs: CompiledRun[],
  align: CompiledLine["align"],
  typography: Typography | null,
  overrides: { fontFamily?: string; fontSizePt?: number; lineHeight?: number } = {},
  indent = 0,
): CompiledLine {
  return {
    runs,
    align,
    fontFamily: overrides.fontFamily ?? typography?.fontFamily ?? FALLBACK_FONT,
    fontSizePt: overrides.fontSizePt ?? typography?.fontSizePt ?? FALLBACK_SIZE,
    lineHeight: overrides.lineHeight ?? typography?.lineHeight ?? FALLBACK_LINE_HEIGHT,
    firstLineIndentIn: indent,
    spaceAfterEm: typography?.paragraphSpacingEm ?? 0,
  };
}

/**
 * Turns one item of the stitched document into lines.
 *
 * A table becomes its cells, one line each, centred. A title page's table is
 * doing layout rather than tabulation — it is a way of placing a few lines on a
 * page — and neither output format needs a grid to say that.
 */
function nodesFor(
  item: DocumentItem,
  prose: { content: unknown; contentText: string } | null,
): CompiledNode[] {
  const out: CompiledNode[] = [];
  const typography = item.typography;
  const smart = item.kind === "block" ? item.smartPunctuation === true : false;
  const indentFirst = item.kind === "block" ? item.firstLineIndent !== false : true;

  for (const node of item.nodes) {
    switch (node.type) {
      case "pageBreak":
        out.push({ kind: "pageBreak" });
        break;

      case "spacer":
        for (let i = 0; i < node.lines; i += 1) {
          out.push({ kind: "line", line: lineFrom([], "left", typography) });
        }
        break;

      case "paragraph":
        out.push({
          kind: "line",
          line: lineFrom(runsFrom(node.spans), node.align, typography, {
            ...(node.fontFamily ? { fontFamily: node.fontFamily } : {}),
            ...(node.fontSizePt ? { fontSizePt: node.fontSizePt } : {}),
            ...(node.lineHeight ? { lineHeight: node.lineHeight } : {}),
          }),
        });
        break;

      case "table":
        for (const row of node.rows) {
          for (const cell of row.cells) {
            const runs = runsFrom(cell.spans);
            if (runs.length === 0) continue;
            out.push({
              kind: "line",
              line: lineFrom(runs, cell.align ?? "center", typography, {
                ...(cell.fontFamily ? { fontFamily: cell.fontFamily } : {}),
                ...(cell.fontSizePt ? { fontSizePt: cell.fontSizePt } : {}),
                ...(cell.lineHeight ? { lineHeight: cell.lineHeight } : {}),
              }),
            });
          }
        }
        break;

      case "content": {
        if (!prose) break;
        const doc = asProseDoc(prose.content);
        const paragraphs = doc
          ? proseParagraphs(doc)
          : prose.contentText
            ? prose.contentText.split(/\n{2,}/).map((text) => [{ type: "text" as const, text }])
            : [];

        paragraphs.forEach((runs, i) => {
          const compiled: CompiledRun[] = runs
            .map((run) => ({
              text: smart ? smartenText(run.text) : run.text,
              ...(hasMark(run, "strong") ? { bold: true } : {}),
              ...(hasMark(run, "em") ? { italic: true } : {}),
              ...(hasMark(run, "underline") ? { underline: true } : {}),
            }))
            .filter((run) => run.text.length > 0);

          // The opening paragraph runs flush when the break above says so;
          // every other paragraph takes the manuscript's indent.
          const flush = i === 0 && !indentFirst;
          out.push({
            kind: "line",
            line: lineFrom(
              compiled,
              typography?.align ?? "left",
              typography,
              {},
              flush ? 0 : (typography?.firstLineIndentIn ?? 0.5),
            ),
          });
        });
        break;
      }
    }
  }
  return out;
}

/**
 * The manuscript, ready to be written out.
 *
 * Front matter is whatever comes before the first block that is part of the
 * structure — in practice the title page. It is separated because a submission
 * counts its pages from the first page of the writing, and carries no running
 * head over the title.
 */
export function compileManuscript(
  input: Parameters<typeof deriveDocument>[0] & {
    prose: Map<string, { content: unknown; contentText: string }>;
    structural: (formatId: string) => boolean;
  },
  options: CompileOptions,
): CompiledManuscript {
  const items = deriveDocument(input);
  const wanted = options.include?.length ? new Set(options.include) : null;

  // Which block each item belongs to, and whether that block is part of the
  // structure. A break belongs to the block it precedes — it is that block's
  // opening — so the writing begins at the break above the first chapter, not
  // after it. Deciding this per item in order put that break in the front
  // matter, which is a page before the title page.
  const formatOf = new Map(input.blocks.map((b) => [b.id, b.formatId]));
  const isStructural = (blockId: string) => {
    const formatId = formatOf.get(blockId);
    return formatId ? input.structural(formatId) : true;
  };

  const front: CompiledNode[] = [];
  const body: CompiledNode[] = [];
  let started = false;

  for (const item of items) {
    const blockId = item.kind === "break" ? item.blockId : item.block.id;
    if (wanted && !wanted.has(blockId)) continue;

    if (!started && isStructural(blockId)) started = true;

    const prose = item.kind === "block" ? (input.prose.get(item.block.id) ?? null) : null;
    const nodes = nodesFor(item, prose);
    if (started) body.push(...nodes);
    else front.push(...nodes);
  }

  const surname = input.work.authorLastName?.trim() || input.work.authorFirstName?.trim() || "";
  const shortTitle = options.shortTitle.trim().toLocaleUpperCase("en");

  return {
    front,
    body,
    runningHead: options.runningHeads ? { surname, shortTitle } : null,
  };
}
