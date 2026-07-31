import type { NumberFormat, VariableName } from "./variables.js";

/**
 * Templates are the reusable library the writer composes from. Two categories,
 * and the distinction is where they render:
 *
 *  - `break` — a split *between* blocks. Chapter break, section break. Derived
 *    from the block's level, never stored on the block itself, so moving a
 *    block to a different indentation changes the break before it.
 *  - `block-format` — wraps a block's *own* content. Regular text, title page.
 */
export const TEMPLATE_CATEGORIES = ["break", "block-format"] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

// --- Template body ------------------------------------------------------

export type TemplateAlign = "left" | "center" | "right";

export interface TemplateMarks {
  bold?: boolean;
  italic?: boolean;
  smallCaps?: boolean;
  allCaps?: boolean;
}

export type TemplateInline =
  | ({ type: "text"; text: string } & TemplateMarks)
  | ({ type: "variable"; name: VariableName; numberFormat?: NumberFormat } & TemplateMarks);

export type TemplateNode =
  | { type: "paragraph"; align?: TemplateAlign; content: TemplateInline[] }
  /** Vertical whitespace measured in blank lines — the usual scene-break unit. */
  | { type: "spacer"; lines: number }
  | { type: "pageBreak" }
  /** Where the block's own prose lands. Meaningful in `block-format` only. */
  | { type: "content" };

export interface TemplateBody {
  nodes: TemplateNode[];
}

// --- Category-specific settings -----------------------------------------

export interface BreakTemplateSettings {
  /**
   * Skip this break when the block is the first child of its parent. Separator
   * breaks set it — an ornament directly beneath a chapter heading is wrong.
   * Heading breaks don't: "Part One" should still be followed by "Chapter 1".
   */
  suppressOnFirstChild: boolean;
  /**
   * Whether the paragraph that opens after this break is indented.
   *
   * The usual convention is flush — an opening paragraph has nothing to be
   * separated from — but indenting throughout is a real house style, so it's a
   * per-break choice. Absent means flush, which is what every existing break
   * already did.
   */
  indentFirstParagraph?: boolean;
}

export interface BlockFormatSettings {
  /** Regular text yes, title page no. Breaks never count, unconditionally. */
  countsTowardWordCount: boolean;
  /**
   * Whether the block takes part in level and break derivation. Notes and front
   * matter opt out, so a title page at depth 0 doesn't inherit the part break.
   */
  structural: boolean;
  /** False for notes: present in the outline, absent from the document. */
  rendersInDocument: boolean;
}

// --- Built-ins ----------------------------------------------------------

/**
 * Seeded on first run and undeletable. The writer can add others — subsection
 * break, epigraph, and so on — and edit these, but not remove them.
 */
export const BUILTIN_TEMPLATE_KEYS = [
  "regular-text",
  "title-page",
  "note",
  "chapter-break",
  "section-break",
] as const;

export type BuiltinTemplateKey = (typeof BUILTIN_TEMPLATE_KEYS)[number];
