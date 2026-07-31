import { XMLParser } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";
import type { ImportedParagraph } from "@brigid/shared";
import { badRequest } from "../lib/errors.js";

/**
 * Pull the paragraph stream out of a .docx.
 *
 * A .docx is a zip whose `word/document.xml` holds the text. We take paragraphs
 * (`w:p`), their text runs (`w:t`), and page breaks — both the explicit kind a
 * writer inserts (`w:br w:type="page"`) and the hint Word leaves behind at last
 * render (`w:lastRenderedPageBreak`).
 *
 * Worth knowing: Word does not store where soft page breaks fall. Pagination is
 * computed at layout time from the page size, fonts and printer metrics, so
 * "the first page" is only knowable when the document contains an explicit
 * break or was last saved by Word with its render hints intact.
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

/** Text of one `w:p`, plus whether it carries a page break. */
function readParagraph(children: unknown): { text: string; pageBreak: boolean } {
  let text = "";
  let pageBreak = false;

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
          if (attrs(entry)["@_w:type"] === "page") pageBreak = true;
          else text += " ";
          continue;
        }
        if (key === "w:lastRenderedPageBreak") {
          pageBreak = true;
          continue;
        }
        if (key === "#text") continue;
        visit(value);
      }
    }
  };

  visit(children);
  return { text, pageBreak };
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
          const { text, pageBreak } = readParagraph(value);
          // A break found inside a paragraph belongs to that paragraph; one
          // found in an empty paragraph carries to the next with content.
          const trimmed = text.trim();
          if (trimmed) {
            paragraphs.push({ text, ...(pendingBreak || pageBreak ? { pageBreakBefore: true } : {}) });
            pendingBreak = false;
          } else if (pageBreak) {
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
