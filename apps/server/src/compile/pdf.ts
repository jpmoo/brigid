import PDFDocument from "pdfkit";
import type { CompiledLine, CompiledManuscript, CompiledNode, CompiledTable } from "./plan.js";

/**
 * The manuscript as a PDF.
 *
 * pdfkit does the flowing. An earlier version kept its own cursor and decided
 * every page break itself, which fought the library rather than using it: text
 * that overran a page made pdfkit add one of its own, the hand-kept cursor knew
 * nothing about it, and the result was pages with a paragraph at the top, a
 * hand's width of nothing, and a paragraph at the bottom. Here the document's
 * own position is the only position, and a page appearing — however it appeared
 * — is what draws the running head.
 */

const INCH = 72; // PostScript points, which is what PDFs measure in.
const MARGIN = INCH;
const PAGE = { width: 612, height: 792 };
const USABLE = PAGE.width - MARGIN * 2;

/**
 * The base fourteen, which every reader has without embedding. A manuscript is
 * set in one of these by convention, and asking for anything else quietly gets
 * the nearest of them rather than failing to open.
 */
function faceFor(stack: string, bold = false, italic = false): string {
  const first = (stack.split(",")[0] ?? "").replace(/^["']|["']$/g, "").trim().toLowerCase();
  const family =
    first.includes("times") || (first.includes("serif") && !first.includes("sans"))
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

/**
 * The face and size in use, so a page break arriving mid-paragraph can put them
 * back. pdfkit will report neither without reaching into it, so it is recorded
 * on the way past instead.
 */
const current = { font: "Times-Roman", size: 12 };

function use(doc: PDFKit.PDFDocument, font: string, size: number): void {
  current.font = font;
  current.size = size;
  doc.font(font).fontSize(size);
}

export async function toPdf(manuscript: CompiledManuscript): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    autoFirstPage: false,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const head = manuscript.runningHead;
  let inBody = false;
  let numbered = 0;

  /**
   * Every page, whoever asked for it.
   *
   * pdfkit adds one of its own the moment text overruns, in the middle of
   * drawing a paragraph — and those pages need a head as much as the ones we
   * ask for. Which means this runs *inside* a half-finished paragraph, so
   * everything it touches has to be put back: the paragraph resumes on the new
   * page and would otherwise resume in the head's face, at the head's size,
   * from wherever the head left the cursor.
   */
  doc.on("pageAdded", () => {
    if (!inBody || !head) return;
    numbered += 1;

    const face = current.font;
    const size = current.size;
    const x = doc.x;
    const y = doc.y;

    doc.font("Courier").fontSize(12);
    doc.text(
      `${head.surname ? `${head.surname} / ` : ""}${head.shortTitle} / ${numbered}`,
      MARGIN,
      MARGIN / 2,
      { width: USABLE, align: "right", lineBreak: false },
    );

    doc.font(face).fontSize(size);
    doc.x = x;
    doc.y = y;
  });

  const draw = (nodes: CompiledNode[]) => {
    doc.addPage();
    for (const node of nodes) {
      if (node.kind === "pageBreak") doc.addPage();
      else if (node.kind === "table") drawTable(doc, node.table);
      else drawLine(doc, node.line);
    }
  };

  if (manuscript.front.length > 0) draw(manuscript.front);
  inBody = true;
  draw(manuscript.body);

  doc.end();
  return finished;
}

function drawLine(doc: PDFKit.PDFDocument, line: CompiledLine): void {
  const leading = line.fontSizePt * line.lineHeight;

  // A blank line is spacing. Asking pdfkit to draw nothing moves nothing, so
  // the space is taken directly — and if that runs past the page, the next one
  // starts, which is what a blank line at a page's foot means.
  if (line.runs.length === 0) {
    doc.y += leading;
    if (doc.y > PAGE.height - MARGIN) doc.addPage();
    return;
  }

  const first = line.runs[0];
  if (!first) return;

  // The gap that turns the font's own line into the manuscript's.
  use(doc, faceFor(line.fontFamily, first.bold, first.italic), line.fontSizePt);
  const lineGap = Math.max(0, leading - doc.currentLineHeight(true));
  const indent = line.firstLineIndentIn * INCH;

  /**
   * Centred and right-aligned lines are placed by hand.
   *
   * pdfkit aligns each `continued` segment on its own, so a centred line built
   * from two runs — "Chapter " and "One", or a title and its subtitle — draws
   * both centred, one on top of the other. These lines are short by nature: a
   * chapter head, a title, a byline. Measured and laid end to end, they keep
   * both their alignment and their marks.
   */
  if ((line.align === "center" || line.align === "right") && line.runs.length > 1) {
    let total = 0;
    for (const run of line.runs) {
      use(doc, faceFor(line.fontFamily, run.bold, run.italic), line.fontSizePt * (run.sizeScale ?? 1));
      total += doc.widthOfString(run.text);
    }

    if (doc.y + leading > PAGE.height - MARGIN) doc.addPage();
    const top = doc.y;
    let x = MARGIN + (line.align === "center" ? (USABLE - total) / 2 : USABLE - total);

    for (const run of line.runs) {
      use(doc, faceFor(line.fontFamily, run.bold, run.italic), line.fontSizePt * (run.sizeScale ?? 1));
      doc.text(run.text, x, top, {
        lineBreak: false,
        ...(run.underline === true ? { underline: true } : {}),
      });
      x += doc.widthOfString(run.text);
    }
    doc.x = MARGIN;
    doc.y = top + leading;
  } else {
    doc.x = MARGIN;
    line.runs.forEach((run, i) => {
      use(doc, faceFor(line.fontFamily, run.bold, run.italic), line.fontSizePt * (run.sizeScale ?? 1));
      doc.text(run.text, {
        width: USABLE,
        align: line.align,
        indent: i === 0 ? indent : 0,
        lineGap,
        // Left-aligned continuation is the one pdfkit gets right, and it is
        // what keeps a bold word inside its sentence.
        continued: i < line.runs.length - 1,
        ...(run.underline === true ? { underline: true } : {}),
      });
    });
  }

  doc.y += line.spaceAfterEm * line.fontSizePt;
}

/**
 * A table, drawn as columns.
 *
 * A title page uses one to place a few lines on a page, so what matters is that
 * each cell keeps its column and its footing. Each row takes the height of its
 * tallest cell and moves to the next page whole rather than being split.
 */
function drawTable(doc: PDFKit.PDFDocument, table: CompiledTable): void {
  const rule = table.borders.widthPt;

  for (const row of table.rows) {
    const heights = row.cells.map((cell) =>
      cell.lines.reduce((sum, line) => sum + line.fontSizePt * line.lineHeight, 0),
    );
    const rowHeight = Math.max(...heights, 0);

    if (doc.y + rowHeight > PAGE.height - MARGIN) doc.addPage();
    const top = doc.y;
    let x = MARGIN;

    row.cells.forEach((cell, i) => {
      const width = (cell.width / 100) * USABLE;
      const own = heights[i] ?? 0;
      const slack = rowHeight - own;
      const offset =
        cell.verticalAlign === "middle" ? slack / 2 : cell.verticalAlign === "bottom" ? slack : 0;

      let y = top + offset;
      for (const line of cell.lines) {
        const leading = line.fontSizePt * line.lineHeight;
        // Runs within a cell are laid end to end for the same reason a centred
        // line is: each would otherwise be aligned on its own.
        let total = 0;
        for (const run of line.runs) {
          use(doc, faceFor(line.fontFamily, run.bold, run.italic), line.fontSizePt * (run.sizeScale ?? 1));
          total += doc.widthOfString(run.text);
        }
        let cellX =
          x +
          (line.align === "center"
            ? Math.max(0, (width - total) / 2)
            : line.align === "right"
              ? Math.max(0, width - total)
              : 0);

        for (const run of line.runs) {
          use(doc, faceFor(line.fontFamily, run.bold, run.italic), line.fontSizePt * (run.sizeScale ?? 1));
          doc.text(run.text, cellX, y, {
            lineBreak: false,
            ...(run.underline === true ? { underline: true } : {}),
          });
          cellX += doc.widthOfString(run.text);
        }
        y += leading;
      }

      if (table.borders.columns && i > 0) {
        doc.lineWidth(rule).moveTo(x, top).lineTo(x, top + rowHeight).stroke();
      }
      x += width;
    });

    if (table.borders.rows) {
      doc.lineWidth(rule).moveTo(MARGIN, top).lineTo(MARGIN + USABLE, top).stroke();
    }
    doc.x = MARGIN;
    doc.y = top + rowHeight;
  }

  if (table.borders.outer) {
    doc.lineWidth(rule).rect(MARGIN, doc.y, USABLE, 0).stroke();
  }
}
