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
   * Take everything up to the first page break as a title page, reproduced
   * literally rather than mapped onto variables.
   */
  firstPageIsTitlePage: boolean;
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
    // Everything before the first explicit page break. Word only records those
    // reliably — soft pagination is layout, computed at render, not stored.
    while (index < input.paragraphs.length) {
      const para = input.paragraphs[index];
      if (!para) break;
      if (index > 0 && para.pageBreakBefore) break;
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
