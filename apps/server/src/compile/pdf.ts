import PDFDocument from "pdfkit";
import type { CompiledLine, CompiledManuscript, CompiledNode } from "./plan.js";

/**
 * The manuscript as a PDF.
 *
 * Laid out by hand, because a PDF has no reflow: every line break, every page
 * break and the running head's position are decided here rather than by a
 * viewer. The plan says what to set; this decides where it lands.
 */

const INCH = 72; // PostScript points, which is what PDFs measure in.
const MARGIN = INCH;

/**
 * The base fourteen, which every reader has without embedding. A manuscript is
 * set in one of these by convention, and asking for anything else quietly gets
 * the nearest of them rather than failing to open.
 */
function faceFor(stack: string, bold: boolean, italic: boolean): string {
  const first = (stack.split(",")[0] ?? "").replace(/^["']|["']$/g, "").trim().toLowerCase();
  const family = first.includes("times") || first.includes("serif") && !first.includes("sans")
    ? "Times"
    : first.includes("helvetica") || first.includes("arial") || first.includes("sans")
      ? "Helvetica"
      : "Courier";

  if (family === "Times") {
    if (bold && italic) return "Times-BoldItalic";
    if (bold) return "Times-Bold";
    if (italic) return "Times-Italic";
    return "Times-Roman";
  }
  const suffix = bold && italic ? "-BoldOblique" : bold ? "-Bold" : italic ? "-Oblique" : "";
  return `${family}${suffix}`;
}

interface Cursor {
  y: number;
  page: number;
}

export async function toPdf(manuscript: CompiledManuscript): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: MARGIN, autoFirstPage: false });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const width = doc.page?.width ?? 612;
  const usable = 612 - MARGIN * 2;
  const bottom = 792 - MARGIN;
  void width;

  const head = manuscript.runningHead;
  const cursor: Cursor = { y: MARGIN, page: 0 };
  /** Pages of the manuscript proper, which is what the head counts. */
  let numbered = 0;

  const newPage = (withHead: boolean) => {
    doc.addPage({ size: "LETTER", margin: MARGIN });
    cursor.page += 1;
    cursor.y = MARGIN;

    if (!withHead || !head) return;
    numbered += 1;
    const text = `${head.surname ? `${head.surname} / ` : ""}${head.shortTitle} / ${numbered}`;
    doc.font("Courier").fontSize(12);
    // In the top margin, right-aligned, clear of the text block below it.
    doc.text(text, MARGIN, MARGIN / 2, { width: usable, align: "right" });
    doc.y = MARGIN;
  };

  const draw = (nodes: CompiledNode[], withHead: boolean) => {
    newPage(withHead);
    let breakPending = false;

    for (const node of nodes) {
      if (node.kind === "pageBreak") {
        breakPending = true;
        continue;
      }
      if (breakPending) {
        newPage(withHead);
        breakPending = false;
      }
      drawLine(doc, node.line, cursor, () => newPage(withHead), usable, bottom);
    }
  };

  if (manuscript.front.length > 0) draw(manuscript.front, false);
  draw(manuscript.body, true);

  doc.end();
  return finished;
}

function drawLine(
  doc: PDFKit.PDFDocument,
  line: CompiledLine,
  cursor: Cursor,
  nextPage: () => void,
  usable: number,
  bottom: number,
): void {
  const leading = line.fontSizePt * line.lineHeight;

  // An empty line is spacing, and spacing that would fall off the page is
  // spacing at the top of the next one — which is to say, nothing.
  if (line.runs.length === 0) {
    cursor.y += leading;
    if (cursor.y > bottom) nextPage();
    return;
  }

  const indent = line.firstLineIndentIn * INCH;

  // Measured before it is drawn, so a paragraph that would start on the last
  // line of a page and finish on the next still knows where it began.
  doc.font(faceFor(line.fontFamily, false, false)).fontSize(line.fontSizePt);

  // Runs are drawn in sequence on one flowing paragraph. pdfkit continues a
  // line when told to, which is what keeps a bold word inside its sentence
  // rather than on a line of its own.
  const first = line.runs[0];
  if (!first) return;

  if (cursor.y + leading > bottom) nextPage();

  doc.y = cursor.y;
  doc.x = MARGIN;

  const options = {
    width: usable,
    align: line.align,
    indent,
    lineGap: leading - line.fontSizePt * 1.15,
  } as const;

  const before = doc.y;
  line.runs.forEach((run, i) => {
    doc.font(faceFor(line.fontFamily, run.bold === true, run.italic === true));
    doc.fontSize(line.fontSizePt);
    const last = i === line.runs.length - 1;
    doc.text(run.text === "\n" ? "\n" : run.text, {
      ...options,
      continued: !last,
      ...(run.underline === true ? { underline: true } : {}),
    });
  });

  const grew = doc.y - before;
  cursor.y = before + (grew > 0 ? grew : leading) + line.spaceAfterEm * line.fontSizePt;
  if (cursor.y > bottom) nextPage();
}
