import { XMLParser } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";
import type { ImportedParagraph } from "@brigid/shared";
import { badRequest } from "../lib/errors.js";

/**
 * Pull the paragraph stream out of a .docx.
 *
 * A .docx is a zip whose `word/document.xml` holds the text. We take paragraphs
 * (`w:p`), their text runs (`w:t`), and page breaks. Word records a page break
 * four different ways depending on how the writer made it, and all four are
 * common:
 *
 *  - `w:br w:type="page"` — an inserted break (Ctrl+Enter)
 *  - `w:pageBreakBefore` in the paragraph's properties — the "page break
 *    before" paragraph setting, which Word's Heading styles set by default, so
 *    this is what most chapter-per-page manuscripts actually contain
 *  - `w:sectPr` — a section break, which starts a new page unless it says
 *    otherwise; it lives on the *last* paragraph of the outgoing section
 *  - `w:lastRenderedPageBreak` — the hint Word leaves at its last render
 *
 * Only the first three are authored; the last is layout Word happened to save.
 * Soft page breaks are not stored at all — pagination is computed at layout
 * from page size, fonts and printer metrics.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Every element as an array, so a document with one paragraph and one with
  // hundreds take the same code path.
  isArray: () => true,
  preserveOrder: true,
  trimValues: false,
});

type Node = Record<string, unknown>;

/** Depth-first walk over preserveOrder output, yielding [tagName, children]. */
function* walk(nodes: unknown): Generator<[string, unknown]> {
  if (!Array.isArray(nodes)) return;
  for (const entry of nodes) {
    if (!entry || typeof entry !== "object") continue;
    for (const [key, value] of Object.entries(entry as Node)) {
      if (key === ":@") continue;
      yield [key, value];
    }
  }
}

function attrs(entry: unknown): Record<string, string> {
  if (!entry || typeof entry !== "object") return {};
  const at = (entry as Node)[":@"];
  return (at as Record<string, string>) ?? {};
}

/** Text of one `w:p`, plus the page breaks it carries and which side they fall on. */
function readParagraph(children: unknown): {
  text: string;
  breakBefore: boolean;
  breakAfter: boolean;
} {
  let text = "";
  let breakBefore = false;
  let breakAfter = false;

  const visit = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const entry of nodes) {
      if (!entry || typeof entry !== "object") continue;
      for (const [key, value] of Object.entries(entry as Node)) {
        if (key === ":@") continue;

        if (key === "w:t") {
          // preserveOrder puts character data under #text.
          for (const [k2, v2] of walk(value)) {
            if (k2 === "#text") text += String(v2 ?? "");
          }
          continue;
        }
        if (key === "w:tab") {
          text += "\t";
          continue;
        }
        if (key === "w:br") {
          if (attrs(entry)["@_w:type"] === "page") breakBefore = true;
          else text += " ";
          continue;
        }
        if (key === "w:lastRenderedPageBreak") {
          breakBefore = true;
          continue;
        }
        if (key === "w:pageBreakBefore") {
          // Absent w:val means true; only an explicit false turns it off.
          const val = attrs(entry)["@_w:val"];
          if (val !== "0" && val !== "false") breakBefore = true;
          continue;
        }
        if (key === "w:sectPr") {
          // A section break sits on the last paragraph of the outgoing section,
          // so it opens a page for whatever comes next. "continuous" doesn't.
          let type: string | undefined;
          for (const child of Array.isArray(value) ? value : []) {
            if (child && typeof child === "object" && "w:type" in (child as Node)) {
              type = attrs(child)["@_w:val"];
            }
          }
          if (type !== "continuous") breakAfter = true;
          continue;
        }
        if (key === "#text") continue;
        visit(value);
      }
    }
  };

  visit(children);
  return { text, breakBefore, breakAfter };
}

export function extractDocxParagraphs(file: Uint8Array): ImportedParagraph[] {
  let documentXml: string;
  try {
    const files = unzipSync(file, { filter: (f) => f.name === "word/document.xml" });
    const entry = files["word/document.xml"];
    if (!entry) throw new Error("no word/document.xml inside");
    documentXml = strFromU8(entry);
  } catch (err) {
    throw badRequest(
      `that doesn't look like a .docx: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const tree = parser.parse(documentXml);
  const paragraphs: ImportedParagraph[] = [];
  let pendingBreak = false;

  const visit = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return;
    for (const entry of nodes) {
      if (!entry || typeof entry !== "object") continue;
      for (const [key, value] of Object.entries(entry as Node)) {
        if (key === ":@" || key === "#text") continue;
        if (key === "w:p") {
          const { text, breakBefore, breakAfter } = readParagraph(value);
          // A break on an empty paragraph carries forward to the next paragraph
          // that actually has content, so a spacer line doesn't swallow it.
          const trimmed = text.trim();
          if (trimmed) {
            paragraphs.push({
              text,
              ...(pendingBreak || breakBefore ? { pageBreakBefore: true } : {}),
            });
            pendingBreak = breakAfter;
          } else if (breakBefore || breakAfter) {
            pendingBreak = true;
          }
          continue;
        }
        visit(value);
      }
    }
  };

  visit(tree);

  if (paragraphs.length === 0) throw badRequest("no text found in that document");
  return paragraphs;
}
