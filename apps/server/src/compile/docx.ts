import {
  AlignmentType,
  Document,
  Footer,
  Header,
  LineRuleType,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { CompiledLine, CompiledManuscript, CompiledNode } from "./plan.js";

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
        size: half,
        ...(i === 0 && pageBreakBefore ? {} : {}),
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

function paragraphsFor(nodes: CompiledNode[]): Paragraph[] {
  const out: Paragraph[] = [];
  let breakPending = false;

  for (const node of nodes) {
    if (node.kind === "pageBreak") {
      breakPending = true;
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
      children: paragraphsFor(manuscript.front),
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
    children: paragraphsFor(manuscript.body),
  });

  return Packer.toBuffer(new Document({ sections }));
}
