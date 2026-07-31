import type {
  BlockFormatSettings,
  BreakTemplateSettings,
  TemplateBody,
  TemplateCategory,
} from "./templates.js";
import type { CounterRestart } from "./variables.js";

/**
 * The minimum a block has to look like to be placed in the outline. The server
 * and the client both hold richer shapes; everything here is generic over them
 * so neither has to strip fields to call in.
 */
export interface BlockNode {
  id: string;
  parentId: string | null;
  sortKey: string;
  label: string | null;
  formatId: string;
  wordCount: number;
  /**
   * A detached break instance. Absent or null means this block's break still
   * renders from its level's template, so moving the block between indentations
   * changes it. Once edited, the break belongs to the block and stops following
   * the level.
   */
  breakTemplateId?: string | null;
  breakBody?: TemplateBody | null;
}

export interface TemplateLike {
  id: string;
  category: TemplateCategory;
  name: string;
  body: TemplateBody;
  breakSettings: BreakTemplateSettings | null;
  formatSettings: BlockFormatSettings | null;
}

export interface LevelLike {
  depth: number;
  name: string;
  breakTemplateId: string | null;
  counterRestart: CounterRestart;
}

export interface OutlineEntry<B extends BlockNode = BlockNode> {
  block: B;
  /** 0 for a top-level block. Indexes into the work's levels. */
  depth: number;
  /** Position among its siblings, 0-based. */
  siblingIndex: number;
  /**
   * True for the first block under a given parent. Break templates use this to
   * suppress a separator that would otherwise land directly beneath a heading.
   */
  isFirstChild: boolean;
  childCount: number;
  /** Ancestor ids, outermost first. Empty at the top level. */
  ancestors: string[];
}

const bySortKey = (a: BlockNode, b: BlockNode) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);

/**
 * Flatten the block tree into document order: depth-first, siblings by sort key.
 * This single ordering drives both the outline panel and the stitched document,
 * so the two can never disagree about what follows what.
 *
 * Blocks whose parent is missing from the input are treated as roots rather than
 * dropped — a partial fetch should render short, not render wrong.
 */
export function buildOutline<B extends BlockNode>(blocks: readonly B[]): OutlineEntry<B>[] {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const children = new Map<string | null, B[]>();

  for (const block of blocks) {
    const parentKey = block.parentId && byId.has(block.parentId) ? block.parentId : null;
    const bucket = children.get(parentKey);
    if (bucket) bucket.push(block);
    else children.set(parentKey, [block]);
  }
  for (const bucket of children.values()) bucket.sort(bySortKey);

  const out: OutlineEntry<B>[] = [];
  const seen = new Set<string>();

  const walk = (parentId: string | null, depth: number, ancestors: string[]): void => {
    const bucket = children.get(parentId) ?? [];
    bucket.forEach((block, siblingIndex) => {
      // A cycle would otherwise recurse forever. Data shouldn't contain one, but
      // an outline that renders is worth more than one that hangs the tab.
      if (seen.has(block.id)) return;
      seen.add(block.id);

      out.push({
        block,
        depth,
        siblingIndex,
        isFirstChild: siblingIndex === 0,
        childCount: (children.get(block.id) ?? []).length,
        ancestors,
      });
      walk(block.id, depth + 1, [...ancestors, block.id]);
    });
  };

  walk(null, 0, []);
  return out;
}

/**
 * Counter value for every entry, keyed by block id.
 *
 * Only blocks whose format is `structural` are counted — a title page sitting at
 * depth 0 shouldn't consume "Chapter 1". Whether a level restarts beneath each
 * parent or runs straight through the manuscript comes from the level itself,
 * because both are ordinary conventions in print: chapters usually run 1..n
 * across a book with parts, while scenes restart within each chapter.
 */
export function computeCounters<B extends BlockNode>(
  entries: readonly OutlineEntry<B>[],
  levels: readonly LevelLike[],
  templates: ReadonlyMap<string, TemplateLike>,
): Map<string, number> {
  const levelByDepth = new Map(levels.map((l) => [l.depth, l]));
  const counters = new Map<string, number>();
  // Keyed by `${depth}:${parentId}` for restarting levels, `${depth}` otherwise.
  const running = new Map<string, number>();

  for (const entry of entries) {
    const format = templates.get(entry.block.formatId);
    if (!format?.formatSettings?.structural) continue;

    const level = levelByDepth.get(entry.depth);
    const scope =
      level?.counterRestart === "under-parent"
        ? `${entry.depth}:${entry.block.parentId ?? "root"}`
        : `${entry.depth}`;

    const next = (running.get(scope) ?? 0) + 1;
    running.set(scope, next);
    counters.set(entry.block.id, next);
  }

  return counters;
}
