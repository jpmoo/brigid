import { formatNumber } from "./numbering.js";
import { buildOutline, computeCounters } from "./outline.js";
import type { BlockNode, LevelLike, OutlineEntry, TemplateLike } from "./outline.js";
import type {
  SectionStart,
  TableBorders,
  TableColumn,
  TemplateAlign,
  TemplateInline,
  TemplateMarks,
  TemplateNode,
  Typography,
} from "./templates.js";
import { VARIABLES } from "./variables.js";
import type { VariableName } from "./variables.js";

/** The work-level facts templates can draw on. */
export interface WorkMeta {
  title: string;
  subtitle: string | null;
  authorFirstName: string | null;
  authorLastName: string | null;
}

export interface RenderContext {
  work: WorkMeta;
  /** Manuscript total, from formats that opt in. */
  totalWordCount: number;
  /**
   * Placeholder for variables that need real pagination. The drafting view is
   * page-*like*, so "page 12 of 340" cannot be known until export; showing a
   * visible token is honest, where showing a number would be a lie.
   */
  unresolved?: (name: VariableName) => string;
}

export interface ResolvedSpan extends TemplateMarks {
  text: string;
  /** Set when the span came from a variable that couldn't be resolved yet. */
  placeholder?: boolean;
  /** A tab stop rather than literal text. */
  tab?: boolean;
  /** A soft line break rather than literal text. */
  lineBreak?: boolean;
}

export interface ResolvedCell {
  spans: ResolvedSpan[];
  align?: TemplateAlign;
  lineHeight?: number;
}

export type ResolvedNode =
  | { type: "paragraph"; align: TemplateAlign; lineHeight?: number; spans: ResolvedSpan[] }
  | { type: "spacer"; lines: number }
  | { type: "pageBreak" }
  | {
      type: "table";
      columns: TableColumn[];
      borders: TableBorders;
      rows: { cells: ResolvedCell[] }[];
    }
  | { type: "content" };

/** One item in the stitched document, in reading order. */
export type DocumentItem<B extends BlockNode = BlockNode> =
  | {
      kind: "break";
      /** The block this break precedes. */
      blockId: string;
      /** The template it came from — the seed, once detached. */
      templateId: string;
      templateName: string;
      /** True when this break has been edited away from its template. */
      detached: boolean;
      /** Manuscript-mode typography, from the template. Null in reading mode. */
      typography: Typography | null;
      nodes: ResolvedNode[];
    }
  | {
      kind: "block";
      block: B;
      entry: OutlineEntry<B>;
      /** The block's format, already resolved. */
      nodes: ResolvedNode[];
      /** True when this block's format has been edited away from its template. */
      formatDetached: boolean;
      /** Manuscript-mode typography, from the block's format template. */
      typography: Typography | null;
      /** Set when this block starts a new numbering / running-head section. */
      sectionStart: SectionStart | null;
      /**
       * Whether this block's opening paragraph is indented. A block that merely
       * continues a scene always is; one that opens after a break follows that
       * break template's `indentFirstParagraph`.
       */
      firstLineIndent: boolean;
    };

/**
 * A detached break keeps its own body but not its own settings — those still
 * come from the template it was seeded from, so changing the house style for
 * chapter openings reaches edited breaks too.
 */
function breakSettingsFor<B extends BlockNode>(
  item: DocumentItem<B> & { kind: "break" },
  templates: ReadonlyMap<string, TemplateLike>,
) {
  return templates.get(item.templateId)?.breakSettings ?? null;
}

const defaultUnresolved = (name: VariableName): string => `[${VARIABLES[name].label.toLowerCase()}]`;

interface SpanContext {
  render: RenderContext;
  counter: number | null;
  levelTitle: string | null;
  blockWordCount: number;
}

function resolveInline(inline: TemplateInline, ctx: SpanContext): ResolvedSpan | null {
  // Neither carries marks, so narrow them away before reading any.
  if (inline.type === "tab") return { text: "\t", tab: true };
  if (inline.type === "lineBreak") return { text: "\n", lineBreak: true };

  const marks: TemplateMarks = {};
  if (inline.bold) marks.bold = true;
  if (inline.italic) marks.italic = true;
  if (inline.smallCaps) marks.smallCaps = true;
  if (inline.allCaps) marks.allCaps = true;

  if (inline.type === "text") return { text: inline.text, ...marks };

  const def = VARIABLES[inline.name];
  const unresolved = ctx.render.unresolved ?? defaultUnresolved;

  if (!def.resolvesWhileDrafting) {
    return { text: unresolved(inline.name), placeholder: true, ...marks };
  }

  let text: string | null;
  switch (inline.name) {
    case "manuscriptTitle":
      text = ctx.render.work.title;
      break;
    case "manuscriptSubtitle":
      text = ctx.render.work.subtitle;
      break;
    case "authorFirstName":
      text = ctx.render.work.authorFirstName;
      break;
    case "authorLastName":
      text = ctx.render.work.authorLastName;
      break;
    case "authorFullName":
      text =
        [ctx.render.work.authorFirstName, ctx.render.work.authorLastName]
          .filter(Boolean)
          .join(" ") || null;
      break;
    case "totalWordCount":
      text = formatNumber(ctx.render.totalWordCount, inline.numberFormat);
      break;
    case "blockWordCount":
      text = formatNumber(ctx.blockWordCount, inline.numberFormat);
      break;
    case "levelCounter":
      text = ctx.counter === null ? null : formatNumber(ctx.counter, inline.numberFormat);
      break;
    case "levelTitle":
      text = ctx.levelTitle;
      break;
    default:
      text = null;
  }

  // An empty work subtitle or a missing chapter label should collapse away
  // rather than leave a placeholder token in the middle of the prose.
  if (text === null || text === "") return null;
  return { text, ...marks };
}

function resolveBody(nodes: readonly TemplateNode[], ctx: SpanContext): ResolvedNode[] {
  const out: ResolvedNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "pageBreak":
        out.push({ type: "pageBreak" });
        break;
      case "spacer":
        out.push({ type: "spacer", lines: node.lines });
        break;
      case "content":
        out.push({ type: "content" });
        break;
      case "table":
        out.push({
          type: "table",
          columns: node.columns,
          borders: node.borders,
          rows: node.rows.map((row) => ({
            // Pad to the column count: a row that is short — from older data,
            // or an edit that raced — would otherwise render missing columns
            // rather than empty ones, which looks like the table lost them.
            cells: Array.from(
              { length: Math.max(node.columns.length, row.cells.length) },
              (_, i) => row.cells[i] ?? { content: [] },
            ).map((cell) => ({
              spans: cell.content
                .map((inline) => resolveInline(inline, ctx))
                .filter((s): s is ResolvedSpan => s !== null),
              ...(cell.align ? { align: cell.align } : {}),
              ...(cell.lineHeight ? { lineHeight: cell.lineHeight } : {}),
            })),
          })),
        });
        break;
      case "paragraph": {
        const spans = node.content
          .map((inline) => resolveInline(inline, ctx))
          .filter((s): s is ResolvedSpan => s !== null);
        // A paragraph whose every span resolved to nothing — an absent subtitle,
        // say — would otherwise render as a stray blank line.
        if (spans.length === 0) break;
        out.push({
          type: "paragraph",
          align: node.align ?? "left",
          ...(node.lineHeight ? { lineHeight: node.lineHeight } : {}),
          spans,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * Resolve a template body on its own, for showing a format as it will look
 * while it's being edited. Level-scoped variables have no block to resolve
 * against here, so they take the sample values a preview needs.
 */
export function previewBody(
  nodes: readonly TemplateNode[],
  work: WorkMeta,
  options: { counter?: number; levelTitle?: string; totalWordCount?: number } = {},
): ResolvedNode[] {
  return resolveBody(nodes, {
    render: { work, totalWordCount: options.totalWordCount ?? 0 },
    counter: options.counter ?? 1,
    levelTitle: options.levelTitle ?? null,
    blockWordCount: 0,
  });
}

export interface DeriveInput<B extends BlockNode> {
  blocks: readonly B[];
  levels: readonly LevelLike[];
  templates: readonly TemplateLike[];
  work: WorkMeta;
  unresolved?: (name: VariableName) => string;
}

/**
 * Turn the block tree into the stitched document.
 *
 * By default the break before a block is looked up from the block's *depth*,
 * not stored on it — which is what makes drag-and-drop meaningful: moving a
 * block to a different indentation changes what precedes it without touching
 * the block.
 *
 * Editing one particular break detaches it. The body is then copied onto the
 * block and takes precedence here, so that break stops following its level and
 * keeps whatever the writer wrote.
 */
export function deriveDocument<B extends BlockNode>(input: DeriveInput<B>): DocumentItem<B>[] {
  const entries = buildOutline(input.blocks);
  const templates = new Map(input.templates.map((t) => [t.id, t]));
  const counters = computeCounters(entries, input.levels, templates);
  const levelByDepth = new Map(input.levels.map((l) => [l.depth, l]));

  const totalWordCount = entries.reduce((sum, entry) => {
    const format = templates.get(entry.block.formatId);
    return format?.formatSettings?.countsTowardWordCount ? sum + entry.block.wordCount : sum;
  }, 0);

  const render: RenderContext = {
    work: input.work,
    totalWordCount,
    ...(input.unresolved ? { unresolved: input.unresolved } : {}),
  };

  const items: DocumentItem<B>[] = [];

  for (const entry of entries) {
    const format = templates.get(entry.block.formatId);
    // Notes live in the outline but never reach the page.
    if (format?.formatSettings && !format.formatSettings.rendersInDocument) continue;

    const ctx: SpanContext = {
      render,
      counter: counters.get(entry.block.id) ?? null,
      levelTitle: entry.block.label,
      blockWordCount: entry.block.wordCount,
    };

    // Front matter and notes opt out of structure, so a title page at depth 0
    // doesn't inherit the part break.
    if (format?.formatSettings?.structural) {
      if (entry.block.breakBody) {
        // Detached: this break was edited for this block specifically, so it
        // renders as written and ignores both the level and the suppression
        // rule — the writer asked for it here.
        const source = entry.block.breakTemplateId
          ? templates.get(entry.block.breakTemplateId)
          : undefined;
        items.push({
          kind: "break",
          blockId: entry.block.id,
          templateId: entry.block.breakTemplateId ?? "",
          templateName: source ? `${source.name} (edited)` : "Edited break",
          detached: true,
          typography: source?.breakSettings?.typography ?? null,
          nodes: resolveBody(entry.block.breakBody.nodes, ctx),
        });
      } else {
        const level = levelByDepth.get(entry.depth);
        const breakTemplate = level?.breakTemplateId
          ? templates.get(level.breakTemplateId)
          : undefined;
        const suppressed = entry.isFirstChild && breakTemplate?.breakSettings?.suppressOnFirstChild;

        if (breakTemplate && !suppressed) {
          items.push({
            kind: "break",
            blockId: entry.block.id,
            templateId: breakTemplate.id,
            templateName: breakTemplate.name,
            detached: false,
            typography: breakTemplate.breakSettings?.typography ?? null,
            nodes: resolveBody(breakTemplate.body.nodes, ctx),
          });
        }
      }
    }

    // An opening paragraph is the one directly after a break, or the very first
    // in the manuscript. Everything else is mid-prose and indents.
    const previous = items[items.length - 1];
    const firstLineIndent =
      previous === undefined
        ? false
        : previous.kind === "break"
          ? (breakSettingsFor(previous, templates)?.indentFirstParagraph ?? false)
          : true;

    items.push({
      kind: "block",
      block: entry.block,
      entry,
      // A detached format wins over the template it was seeded from, so one
      // title page can differ without disturbing every other block using it.
      nodes: entry.block.formatBody
        ? resolveBody(entry.block.formatBody.nodes, ctx)
        : format
          ? resolveBody(format.body.nodes, ctx)
          : [{ type: "content" }],
      formatDetached: Boolean(entry.block.formatBody || entry.block.formatTypography),
      // A block's own type wins over its format's, the same way its own body
      // does — one paragraph can be set differently without disturbing the rest.
      typography: entry.block.formatTypography ?? format?.formatSettings?.typography ?? null,
      sectionStart: format?.formatSettings?.sectionStart ?? null,
      firstLineIndent,
    });
  }

  return items;
}
