import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  LineRuleType,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { CompiledManuscript, CompiledNode, CompiledTable } from "./plan.js";
import type { CompiledLine } from "./plan.js";

/**
 * The manuscript as a Word file.
 *
 * Two sections, because the title page is not page one. The first holds the
 * front matter with no running head and no numbering; the second starts the
 * count at one and carries the head. That is the only structural decision here
 * — everything else about how it is set was settled in the plan.
 */

/** One inch, in the twentieths of a point that OOXML counts in. */
const INCH = 1440;

/**
 * Word wants a face, not a CSS stack. The first named family is the intended
 * one; the rest of a stack is a browser's fallback list and means nothing here.
 */
function faceOf(stack: string): string {
  const first = stack.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "") || "Courier New";
}

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;

function paragraphFor(line: CompiledLine, pageBreakBefore = false): Paragraph {
  const half = Math.round(line.fontSizePt * 2);

  const children = line.runs.flatMap((run, i) => {
    // A soft break inside a template line is a break, not a character.
    if (run.text === "\n") return [new TextRun({ break: 1 })];
    return [
      new TextRun({
        text: run.text,
        bold: run.bold === true,
        italics: run.italic === true,
        underline: run.underline === true ? {} : undefined,
        font: faceOf(line.fontFamily),
        // Half-points, and the plan may have made this one of the small
        // letters of a small-capital run.
        size: Math.round(half * (run.sizeScale ?? 1)),
      }),
    ];
  });

  return new Paragraph({
    ...(pageBreakBefore ? { children: [new PageBreak(), ...children] } : { children }),
    alignment: ALIGN[line.align],
    spacing: {
      // OOXML's "exact" line is in twentieths of a point; the multiplier is on
      // the font size, which is how every rule in this app expresses it.
      line: Math.round(line.fontSizePt * line.lineHeight * 20),
      lineRule: LineRuleType.EXACT,
      after: Math.round(line.spaceAfterEm * line.fontSizePt * 20),
    },
    indent: line.firstLineIndentIn
      ? { firstLine: Math.round(line.firstLineIndentIn * INCH) }
      : undefined,
  });
}

const NONE = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;

/**
 * A table stays a table.
 *
 * A title page uses one to place a few lines on a page, and flattening it to
 * centred paragraphs loses exactly the thing it was for. Widths travel as
 * percentages, because the page is a known width and the template thought in
 * shares of it.
 */
function tableFor(table: CompiledTable): Table {
  const rule = {
    style: BorderStyle.SINGLE,
    size: Math.max(1, Math.round(table.borders.widthPt * 8)),
    color: "auto",
  } as const;

  const vertical = {
    top: VerticalAlign.TOP,
    middle: VerticalAlign.CENTER,
    bottom: VerticalAlign.BOTTOM,
  } as const;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: table.borders.outer ? rule : NONE,
      bottom: table.borders.outer ? rule : NONE,
      left: table.borders.outer ? rule : NONE,
      right: table.borders.outer ? rule : NONE,
      insideHorizontal: table.borders.rows ? rule : NONE,
      insideVertical: table.borders.columns ? rule : NONE,
    },
    rows: table.rows.map(
      (row) =>
        new TableRow({
          children: row.cells.map(
            (cell) =>
              new TableCell({
                width: { size: cell.width, type: WidthType.PERCENTAGE },
                verticalAlign: vertical[cell.verticalAlign],
                children: cell.lines.length
                  ? cell.lines.map((line) => paragraphFor(line))
                  : [new Paragraph({ children: [] })],
              }),
          ),
        }),
    ),
  });
}

function bodyFor(nodes: CompiledNode[]): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  let breakPending = false;

  for (const node of nodes) {
    if (node.kind === "pageBreak") {
      breakPending = true;
      continue;
    }
    if (node.kind === "table") {
      // A table cannot carry a page break itself, so an empty paragraph does
      // the breaking and the table follows it.
      if (breakPending) {
        out.push(new Paragraph({ children: [new PageBreak()] }));
        breakPending = false;
      }
      out.push(tableFor(node.table));
      // Word runs two adjacent tables together; a paragraph between them keeps
      // them apart, and it is also what a following page break attaches to.
      out.push(new Paragraph({ children: [] }));
      continue;
    }
    out.push(paragraphFor(node.line, breakPending));
    breakPending = false;
  }

  // An empty section is not a section as far as Word is concerned.
  if (out.length === 0) out.push(new Paragraph({ children: [] }));
  return out;
}

export async function toDocx(manuscript: CompiledManuscript): Promise<Buffer> {
  const margins = { top: INCH, right: INCH, bottom: INCH, left: INCH };

  const head = manuscript.runningHead;
  const header = head
    ? new Header({
        children: [
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({
                text: `${head.surname ? `${head.surname} / ` : ""}${head.shortTitle} / `,
                font: "Courier New",
                size: 24,
              }),
              // A field, so Word counts the pages rather than us guessing.
              new TextRun({ children: [PageNumber.CURRENT], font: "Courier New", size: 24 }),
            ],
          }),
        ],
      })
    : undefined;

  const sections = [];

  if (manuscript.front.length > 0) {
    sections.push({
      properties: { page: { margin: margins } },
      // No head, and no number: the title page is not page one.
      footers: { default: new Footer({ children: [] }) },
      children: bodyFor(manuscript.front),
    });
  }

  sections.push({
    properties: {
      page: {
        margin: margins,
        // Counting starts here, whatever came before it.
        pageNumbers: { start: 1 },
      },
    },
    ...(header ? { headers: { default: header } } : {}),
    children: bodyFor(manuscript.body),
  });

  return Packer.toBuffer(new Document({ sections }));
}
