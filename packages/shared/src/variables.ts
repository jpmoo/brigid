/**
 * The special-character library: tokens the writer can drop into break
 * templates, block-format templates, headers, and footers.
 *
 * Some resolve against the work (title, author), some against the rendered page
 * (page number), and some against the block's position in the outline (chapter
 * number). Page-scoped variables cannot resolve in the drafting view, which is
 * page-*like* rather than paginated — see `resolvesWhileDrafting`.
 */

export const VARIABLE_NAMES = [
  "pageBreak",
  "pageNumber",
  "totalPages",
  "totalWordCount",
  "manuscriptTitle",
  "manuscriptSubtitle",
  "authorFirstName",
  "authorLastName",
  "authorFullName",
  "levelCounter",
  "levelTitle",
  "runningChapterTitle",
  "blockWordCount",
] as const;

export type VariableName = (typeof VARIABLE_NAMES)[number];

/** What a variable resolves against. */
export type VariableScope = "control" | "work" | "document" | "page" | "level" | "block";

export interface VariableDef {
  name: VariableName;
  /** Shown in the library picker. */
  label: string;
  scope: VariableScope;
  /**
   * A page break is a block-level split; everything else is inline text. The
   * picker presents them in one list regardless — this only tells the editor
   * which kind of node to insert.
   */
  insertAs: "inline" | "block";
  /**
   * False for anything that needs real pagination. These still render in the
   * drafting view, but as a placeholder token rather than a value.
   */
  resolvesWhileDrafting: boolean;
  /** Whether a `numberFormat` may be attached to this variable's node. */
  numeric: boolean;
}

export const VARIABLES: Record<VariableName, VariableDef> = {
  pageBreak: {
    name: "pageBreak",
    label: "Page break",
    scope: "control",
    insertAs: "block",
    resolvesWhileDrafting: true,
    numeric: false,
  },
  pageNumber: {
    name: "pageNumber",
    label: "Page number",
    scope: "page",
    insertAs: "inline",
    resolvesWhileDrafting: false,
    numeric: true,
  },
  totalPages: {
    name: "totalPages",
    label: "Total page numbers",
    scope: "document",
    insertAs: "inline",
    resolvesWhileDrafting: false,
    numeric: true,
  },
  totalWordCount: {
    name: "totalWordCount",
    label: "Total word count",
    scope: "document",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: true,
  },
  manuscriptTitle: {
    name: "manuscriptTitle",
    label: "Manuscript title",
    scope: "work",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: false,
  },
  manuscriptSubtitle: {
    name: "manuscriptSubtitle",
    label: "Manuscript subtitle",
    scope: "work",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: false,
  },
  authorFirstName: {
    name: "authorFirstName",
    label: "Author first name",
    scope: "work",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: false,
  },
  authorLastName: {
    name: "authorLastName",
    label: "Author last name",
    scope: "work",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: false,
  },
  // First and last together, because asking for two chips and a space is the
  // commonest case and the silliest thing to make someone assemble by hand.
  authorFullName: {
    name: "authorFullName",
    label: "Author full name",
    scope: "work",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: false,
  },
  // The chapter break is the reason this variable exists: "Chapter 17" needs
  // the counter for whatever level the break belongs to.
  levelCounter: {
    name: "levelCounter",
    label: "Level number",
    scope: "level",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: true,
  },
  levelTitle: {
    name: "levelTitle",
    label: "Level title",
    scope: "level",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: false,
  },
  runningChapterTitle: {
    name: "runningChapterTitle",
    label: "Running chapter title",
    scope: "page",
    insertAs: "inline",
    resolvesWhileDrafting: false,
    numeric: false,
  },
  blockWordCount: {
    name: "blockWordCount",
    label: "Block word count",
    scope: "block",
    insertAs: "inline",
    resolvesWhileDrafting: true,
    numeric: true,
  },
};

/** How a numeric variable renders. All three are live conventions in print. */
export const NUMBER_FORMATS = [
  "arabic",
  "roman-upper",
  "roman-lower",
  "words-title",
  "words-upper",
] as const;

export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/**
 * Whether a level's counter runs continuously through the manuscript or restarts
 * beneath each parent. Both are used in published fiction: chapters usually run
 * 1..n straight through a book with parts, while scenes restart per chapter.
 */
export const COUNTER_RESTARTS = ["continuous", "under-parent"] as const;

export type CounterRestart = (typeof COUNTER_RESTARTS)[number];
