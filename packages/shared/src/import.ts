/**
 * Turning an imported document into a block tree.
 *
 * The writer supplies a marker per organizational level — "CHAPTER " for
 * chapters, "***" for scene breaks — and every paragraph that starts with one
 * opens a new block at that depth. Matching is **case sensitive** on purpose:
 * a manuscript that writes "CHAPTER ONE" as a heading and "chapter" in the
 * prose would otherwise shatter into nonsense.
 */

/** One paragraph lifted out of the source document. */
export interface ImportedParagraph {
  text: string;
  /** True when an explicit page break precedes this paragraph. */
  pageBreakBefore?: boolean;
}

export interface LevelMarker {
  /** Outline depth this marker opens. 0 is outermost. */
  depth: number;
  /** Level name — "Chapter", "Scene". */
  name: string;
  /** Literal prefix, matched case-sensitively against the start of a line. */
  prefix: string;
  /**
   * Whether the marker line is consumed by the break or kept as prose. A
   * "CHAPTER ONE" heading is a break; a "***" separator is too. Both default to
   * being consumed, since neither is anything a reader should see twice.
   */
  keepLine?: boolean;
}

export interface PlanInput {
  paragraphs: readonly ImportedParagraph[];
  markers: readonly LevelMarker[];
  /**
   * Take the opening of the document as a title page, reproduced literally
   * rather than mapped onto variables.
   */
  firstPageIsTitlePage: boolean;
  /**
   * How many paragraphs the title page covers. Omit to use the first page
   * break. Word's page-break fidelity varies, so this is the manual override
   * for a document whose title page isn't bounded by one.
   */
  titlePageParagraphs?: number;
}

export interface PlannedBlock {
  depth: number;
  /** The remainder of the marker line, if any — "ONE" from "CHAPTER ONE". */
  label: string | null;
  paragraphs: string[];
  /** Marks the block that should use the imported title-page format. */
  isTitlePage?: boolean;
}

export interface ImportPlan {
  titlePage: string[] | null;
  blocks: PlannedBlock[];
  /** Per-marker tally, so the writer can see whether a marker did anything. */
  matches: { depth: number; prefix: string; count: number }[];
}

/**
 * Line feeds are stripped and runs of whitespace collapsed before matching, so
 * a heading broken across two lines in the source, or padded with a stray
 * non-breaking space, still matches its marker.
 */
export function normalizeForMatch(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function planImport(input: PlanInput): ImportPlan {
  const markers = [...input.markers]
    .filter((m) => m.prefix.length > 0)
    // Longest prefix first, so "CHAPTER " wins over "C" when both are defined.
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const counts = new Map<string, number>();
  const blocks: PlannedBlock[] = [];
  let titlePage: string[] | null = null;

  let index = 0;

  if (input.firstPageIsTitlePage) {
    const page: string[] = [];
    const limit = input.titlePageParagraphs;
    // An explicit count wins; otherwise stop at the first page break.
    while (index < input.paragraphs.length) {
      const para = input.paragraphs[index];
      if (!para) break;
      if (limit === undefined) {
        if (index > 0 && para.pageBreakBefore) break;
      } else if (page.length >= limit) {
        break;
      }
      const text = normalizeForMatch(para.text);
      if (text) page.push(text);
      index += 1;
    }
    titlePage = page;
  }

  let current: PlannedBlock | null = null;
  // Returns the block rather than assigning from inside the closure, which
  // would leave the compiler unable to narrow `current` afterwards.
  const open = (depth: number, label: string | null): PlannedBlock => {
    const block: PlannedBlock = { depth, label, paragraphs: [] };
    blocks.push(block);
    return block;
  };

  for (; index < input.paragraphs.length; index += 1) {
    const para = input.paragraphs[index];
    if (!para) continue;
    const text = normalizeForMatch(para.text);
    if (!text) continue;

    const marker = markers.find((m) => text.startsWith(m.prefix));
    if (marker) {
      counts.set(marker.prefix, (counts.get(marker.prefix) ?? 0) + 1);
      const remainder = text.slice(marker.prefix.length).trim();
      current = open(marker.depth, remainder || null);
      if (marker.keepLine) current.paragraphs.push(text);
      continue;
    }

    // Prose before any marker still needs somewhere to live.
    if (!current) current = open(markers[markers.length - 1]?.depth ?? 0, null);
    current.paragraphs.push(text);
  }

  return {
    titlePage,
    blocks,
    matches: input.markers.map((m) => ({
      depth: m.depth,
      prefix: m.prefix,
      count: counts.get(m.prefix) ?? 0,
    })),
  };
}

// --- Detecting the writer's own conventions --------------------------------

export interface MarkerSuggestion {
  prefix: string;
  count: number;
  /** "exact" for a standalone separator line, "prefix" for a heading opener. */
  kind: "exact" | "prefix";
  /** A few lines it matched, so the writer can check it means what they think. */
  samples: string[];
}

/** A separator line: short, and made of punctuation or symbols rather than words. */
function isSeparatorLine(text: string): boolean {
  return text.length > 0 && text.length <= 12 && !/[\p{L}\p{N}]/u.test(text);
}

/**
 * Whether a line looks like a heading rather than a sentence.
 *
 * The load-bearing test is the last character: a heading is a label, so it
 * doesn't end in sentence punctuation, while prose almost always does. Without
 * this, any word two sentences happen to open with — "The", "She" — reads as a
 * chapter marker.
 */
function looksLikeHeading(text: string): boolean {
  if (text.length > 60) return false;
  if (/[.!?,;:"'\u201d\u2019]$/.test(text)) return false;
  return true;
}

/**
 * Read the document and propose the markers it actually uses, rather than
 * assuming. Two shapes cover nearly every manuscript:
 *
 *  - a standalone separator between scenes — "***", "#", "⁂"
 *  - a repeated opening word on short lines — "CHAPTER", "PART"
 *
 * Both need to occur at least twice: one line reading "***" is a typo, three
 * are a convention. Everything is reported with counts and samples so the
 * writer confirms rather than trusts.
 */
export function suggestMarkers(paragraphs: readonly ImportedParagraph[]): MarkerSuggestion[] {
  const exact = new Map<string, string[]>();
  const prefix = new Map<string, string[]>();

  for (const para of paragraphs) {
    const text = normalizeForMatch(para.text);
    if (!text) continue;

    if (isSeparatorLine(text)) {
      const bucket = exact.get(text) ?? [];
      bucket.push(text);
      exact.set(text, bucket);
      continue;
    }

    if (!looksLikeHeading(text)) continue;
    const firstWord = text.split(" ")[0] ?? "";
    // Require an all-caps or Capitalised word of real length, so "the" and "a"
    // don't become candidates.
    if (firstWord.length < 3 || firstWord.length > 20) continue;
    if (!/^[\p{Lu}][\p{L}]*$/u.test(firstWord)) continue;

    const key = `${firstWord} `;
    const bucket = prefix.get(key) ?? [];
    bucket.push(text);
    prefix.set(key, bucket);
  }

  const out: MarkerSuggestion[] = [];
  for (const [text, samples] of exact) {
    if (samples.length >= 2) {
      out.push({ prefix: text, count: samples.length, kind: "exact", samples: samples.slice(0, 3) });
    }
  }
  for (const [key, samples] of prefix) {
    if (samples.length >= 2) {
      out.push({ prefix: key, count: samples.length, kind: "prefix", samples: samples.slice(0, 3) });
    }
  }

  // Headings before separators — the outer level is the more useful default —
  // then by how often each occurs.
  return out
    .sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind === "prefix" ? -1 : 1))
    .slice(0, 8);
}
