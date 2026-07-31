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
  | ({ type: "variable"; name: VariableName; numberFormat?: NumberFormat } & TemplateMarks)
  /** A tab stop. Advances to the next stop rather than inserting fixed space. */
  | { type: "tab" };

/**
 * Tables, for the parts of a manuscript that are genuinely tabular — a title
 * page's contact block, a header with the author on the left and a page number
 * on the right. Deliberately plain: rules, widths and alignment, with no
 * shading or color.
 */
export interface TableColumn {
  /** Share of the table width, 0–1. The set is normalized when rendered. */
  width: number;
  align?: TemplateAlign;
}

export interface TableCell {
  content: TemplateInline[];
  align?: TemplateAlign;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableBorders {
  /** Rule around the outside of the table. */
  outer: boolean;
  /** Rules between rows. */
  rows: boolean;
  /** Rules between columns. */
  columns: boolean;
  widthPt?: number;
}

export type TemplateNode =
  | { type: "paragraph"; align?: TemplateAlign; content: TemplateInline[] }
  /** Vertical whitespace measured in blank lines — the usual scene-break unit. */
  | { type: "spacer"; lines: number }
  | { type: "pageBreak" }
  | { type: "table"; columns: TableColumn[]; rows: TableRow[]; borders: TableBorders }
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
  /** Applied in manuscript mode only. */
  typography?: Typography;
}

/**
 * How a format's text is set when the document is shown as a manuscript.
 *
 * Nothing here is assumed — the submission conventions people quote (12pt
 * Courier, double-spaced, ragged right, half-inch indents) are just the values
 * the built-ins ship with, and every one of them is the writer's to change.
 * Reading mode ignores all of it and uses the app's own typography.
 */
export interface Typography {
  /** CSS font stack, exactly as the writer specifies it. */
  fontFamily?: string;
  fontSizePt?: number;
  fontWeight?: number;
  italic?: boolean;
  /** Multiple of the font size. 2 is double-spaced. */
  lineHeight?: number;
  align?: "left" | "justify" | "center" | "right";
  /** Paragraph indent, in inches — the unit submission guidelines use. */
  firstLineIndentIn?: number;
  /** Blank space between paragraphs, as a multiple of the line height. */
  paragraphSpacingEm?: number;
  /** Distance between tab stops, in inches. */
  tabStopIn?: number;
}

/**
 * Fonts that are actually available without shipping webfonts — the stacks
 * below all resolve on a stock Mac, Windows or Linux box. A manuscript that
 * renders differently on the reader's machine than on the writer's is worse
 * than a plain one.
 */
export const FONT_CHOICES: { label: string; stack: string }[] = [
  { label: "System sans", stack: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif" },
  { label: "System serif", stack: "ui-serif, Georgia, Cambria, Times New Roman, serif" },
  { label: "Courier", stack: '"Courier New", Courier, monospace' },
  { label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { label: "Palatino", stack: "'Palatino Linotype', Palatino, 'Book Antiqua', serif" },
  { label: "Garamond", stack: "Garamond, 'EB Garamond', Georgia, serif" },
  { label: "Baskerville", stack: "Baskerville, 'Libre Baskerville', Georgia, serif" },
  { label: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { label: "Monospace", stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
];

/**
 * Where a block begins a new *section* of the document, in the sense Word and
 * InDesign use the word: a stretch with its own page numbering and its own
 * running heads.
 *
 * Front matter usually suppresses running heads and doesn't count toward the
 * page numbers a submission quotes; the body restarts at 1. All of it is
 * recorded here and consumed at export, where pagination becomes real — the
 * drafting view is page-*like* and can only mark the boundary.
 */
export interface SectionStart {
  /** "restart" begins the page count again at `startPageNumber`, default 1. */
  pageNumbering: "continue" | "restart";
  startPageNumber?: number;
  /** "suppress" leaves the running heads off — the convention for front matter. */
  runningHeads: "continue" | "restart" | "suppress";
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
  /** Applied in manuscript mode only. */
  typography?: Typography;
  /**
   * Absent means the block simply continues the section it lands in — the case
   * for ordinary prose.
   */
  sectionStart?: SectionStart;
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
