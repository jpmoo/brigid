import type { TemplateInline, TemplateMarks } from "./templates.js";
import { NUMBER_FORMATS, VARIABLE_NAMES } from "./variables.js";
import type { NumberFormat, VariableName } from "./variables.js";

/**
 * Templates edit as plain text with `{{variable}}` tokens, so a break can be
 * typed rather than assembled node by node. A number format follows a colon:
 * `{{levelCounter:words-title}}`.
 *
 * Round-tripping through this loses nothing a paragraph editor can express, and
 * keeps the stored shape structured rather than a string to re-parse at render.
 */

const VARIABLE_SET = new Set<string>(VARIABLE_NAMES);
const FORMAT_SET = new Set<string>(NUMBER_FORMATS);
const TOKEN = /\{\{\s*([A-Za-z]+)\s*(?::\s*([a-z-]+)\s*)?\}\}/g;

export function parseInlines(text: string, marks: TemplateMarks = {}): TemplateInline[] {
  const out: TemplateInline[] = [];
  let cursor = 0;

  for (const match of text.matchAll(TOKEN)) {
    const [whole, rawName, rawFormat] = match;
    const at = match.index ?? 0;

    // Anything that isn't a known variable stays literal, so a stray {{ }} in
    // prose survives editing instead of vanishing.
    if (!rawName || !VARIABLE_SET.has(rawName)) continue;

    if (at > cursor) out.push({ type: "text", text: text.slice(cursor, at), ...marks });

    const inline: TemplateInline = {
      type: "variable",
      name: rawName as VariableName,
      ...marks,
    };
    if (rawFormat && FORMAT_SET.has(rawFormat)) inline.numberFormat = rawFormat as NumberFormat;
    out.push(inline);
    cursor = at + whole.length;
  }

  if (cursor < text.length) out.push({ type: "text", text: text.slice(cursor), ...marks });
  return out;
}

export function serializeInlines(inlines: readonly TemplateInline[]): string {
  return inlines
    .map((inline) =>
      inline.type === "text"
        ? inline.text
        : inline.type === "tab"
          ? "\t"
          : `{{${inline.name}${inline.numberFormat ? `:${inline.numberFormat}` : ""}}}`,
    )
    .join("");
}

/** Marks shared by every span in a paragraph, for the editor's mark toggles. */
export function commonMarks(inlines: readonly TemplateInline[]): TemplateMarks {
  if (inlines.length === 0) return {};
  const keys: (keyof TemplateMarks)[] = ["bold", "italic", "smallCaps", "allCaps"];
  const out: TemplateMarks = {};
  for (const key of keys) {
    // Tabs carry no marks; ignoring them keeps one from clearing every toggle.
    const marked = inlines.filter((i) => i.type !== "tab");
    if (marked.length > 0 && marked.every((i) => i[key])) out[key] = true;
  }
  return out;
}
