import { useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Scissors } from "lucide-react";
import { subtreeWordCounts } from "@brigid/shared";
import type { OutlineEntry } from "@brigid/shared";
import type { Block, Placement, Template } from "../api.js";
import type { TemplateBody } from "@brigid/shared";

const wordFmt = new Intl.NumberFormat();

/** Two lines of the block's prose, so a card is recognisable without opening it. */
function preview(block: Block, template?: Template): string {
  // A title page holds no prose of its own — what it says lives in its format,
  // as template lines. Falling back to those gives the card the same excerpt
  // every other card has, rather than leaving it blank and unlike the rest.
  const text = block.contentText.trim() || literalText(template?.body ?? block.formatBody);
  if (!text) return "";
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

/** The words written into a template, ignoring variables and structure. */
function literalText(body: TemplateBody | null | undefined): string {
  if (!body) return "";
  const parts: string[] = [];

  const fromInlines = (content: unknown) => {
    if (!Array.isArray(content)) return;
    for (const item of content) {
      const inline = item as { type?: string; text?: string };
      if (inline.type === "text" && inline.text) parts.push(inline.text);
    }
  };

  for (const node of body.nodes ?? []) {
    const n = node as { type?: string; content?: unknown; rows?: unknown[] };
    if (n.type === "paragraph") fromInlines(n.content);
    if (n.type === "table") {
      for (const row of (n.rows ?? []) as { cells?: { content?: unknown }[] }[]) {
        for (const cell of row.cells ?? []) fromInlines(cell.content);
      }
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * What kind of block this is, for the corner of the card.
 *
 * A format the importer made carries the manuscript's name — "Title page —
 * Pride and Prejudice" — which is useful in the format library and far too long
 * here, where it sits beside "CHAPTER".
 */
export function kindOf(name: string): string {
  return name.split(/\s+—\s+/)[0] ?? name;
}

export const BLOCK_DRAG_TYPE = "application/x-brigid-block";

export interface BreakChip {
  templateName: string;
  detached: boolean;
}

export interface OutlinePanelProps {
  entries: OutlineEntry<Block>[];
  /**
   * The break rendered before each block, keyed by block id. Shown attached to
   * the top of its block: a break belongs to the block it precedes and travels
   * with it, so it is never separately draggable.
   */
  breaks: Map<string, BreakChip>;
  onSelectBreak: (blockId: string) => void;
  templates: Map<string, Template>;
  levels: { depth: number; name: string; wordGoal?: number | null }[];
  selectedId: string | null;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onSelect: (id: string) => void;
  onAdd: (relativeTo: string | null, placement: Placement) => void;
  onRename: (id: string) => void;
  onEditFormat: (id: string) => void;
  onOptions: (id: string) => void;
  onDelete: (id: string) => void;
  /** So the panel can scroll the current block into view as the document moves. */
  registerRef: (blockId: string, el: HTMLDivElement | null) => void;
  /** Reorder within the block's own level. */
  onMove: (blockId: string, parentId: string | null, afterId: string | null) => void;
}

export function OutlinePanel(props: OutlinePanelProps) {
  const { entries, templates, levels, selectedId, collapsed, breaks } = props;
  const totals = subtreeWordCounts(entries);

  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; before: boolean } | null>(null);

  const structural = (blockId: string) =>
    templates.get(entries.find((e) => e.block.id === blockId)?.block.formatId ?? "")?.formatSettings
      ?.structural ?? true;

  const depthOf = (blockId: string) =>
    entries.find((e) => e.block.id === blockId)?.depth ?? -1;

  /**
   * Where a drop would put the block: the target's parent, after whichever
   * sibling precedes the chosen gap. Levels never change, so the parent is
   * always the target's own — a scene can move to another chapter, but it stays
   * a scene.
   */
  const resolveDrop = (targetId: string, before: boolean) => {
    const target = entries.find((e) => e.block.id === targetId);
    if (!target) return null;
    const parentId = target.block.parentId;
    const siblings = entries.filter((e) => e.block.parentId === parentId);
    const index = siblings.findIndex((e) => e.block.id === targetId);
    if (index === -1) return null;

    let afterId = before ? (siblings[index - 1]?.block.id ?? null) : targetId;

    // Nothing goes above front matter: if the first sibling is a title page,
    // the earliest position is after it.
    const first = siblings[0];
    if (afterId === null && first && !structural(first.block.id)) {
      afterId = first.block.id;
    }
    return { parentId, afterId };
  };

  const canDrop = (targetId: string) =>
    dragging !== null &&
    targetId !== dragging &&
    structural(targetId) &&
    depthOf(targetId) === depthOf(dragging);

  // A collapsed block hides its whole subtree, so hidden-ness is inherited.
  const hidden = new Set<string>();
  for (const entry of entries) {
    if (entry.ancestors.some((id) => collapsed.has(id) || hidden.has(id))) hidden.add(entry.block.id);
  }
  const visible = entries.filter((e) => !hidden.has(e.block.id));

  /**
   * A block never travels alone: its children hang off its id, so moving a
   * chapter carries its scenes. The drag says so — the whole subtree lifts,
   * not just the card under the cursor.
   */
  const lifted = new Set<string>();
  if (dragging) {
    lifted.add(dragging);
    for (const entry of entries) {
      if (entry.ancestors.includes(dragging)) lifted.add(entry.block.id);
    }
  }

  /**
   * Where the line is drawn, as a visible entry to draw it beneath — null
   * meaning above everything.
   *
   * Not simply the edge of the card being hovered. Dropping *after* a chapter
   * puts the block after that chapter's scenes as well, since they sit between
   * the two in the outline; a line at the chapter's own bottom edge would
   * promise a landing spot several cards above the real one. So the target is
   * resolved first and the line follows the answer.
   */
  const dropLine = (() => {
    if (!over || !dragging || !canDrop(over.id)) return null;
    const target = resolveDrop(over.id, over.before);
    if (!target) return null;
    if (target.afterId === dragging) return null;
    if (target.afterId === null) return { afterVisible: null, depth: depthOf(over.id) };

    // Past the last of its descendants that is actually on screen.
    const start = visible.findIndex((e) => e.block.id === target.afterId);
    if (start === -1) return null;
    let last = start;
    while (
      last + 1 < visible.length &&
      visible[last + 1]?.ancestors.includes(target.afterId as string)
    ) {
      last += 1;
    }
    return { afterVisible: visible[last]?.block.id ?? null, depth: depthOf(over.id) };
  })();

  const dropRail = (depth: number) => (
    <div className="outline-drop-rail" style={{ marginLeft: depth * 16 }} aria-hidden="true" />
  );

  if (entries.length === 0) {
    return (
      <div className="outline-empty">
        <p>Nothing here yet.</p>
        <button className="btn" type="button" onClick={() => props.onAdd(null, "root")}>
          <Plus size={15} />
          First block
        </button>
      </div>
    );
  }

  return (
    <div className={`outline-list${dragging ? " dragging-block" : ""}`}>
      {dropLine && dropLine.afterVisible === null ? dropRail(dropLine.depth) : null}
      {visible.map((entry) => (
        <div key={entry.block.id}>
        <OutlineCard
          draggable={structural(entry.block.id)}
          isDragging={dragging === entry.block.id}
          isLifted={lifted.has(entry.block.id)}
          onDragStart={() => setDragging(entry.block.id)}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          onDragOverCard={(before) => {
            if (!canDrop(entry.block.id)) return false;
            setOver({ id: entry.block.id, before });
            return true;
          }}
          onDropCard={(before) => {
            const id = dragging;
            setDragging(null);
            setOver(null);
            if (!id || !canDrop(entry.block.id)) return;
            const target = resolveDrop(entry.block.id, before);
            if (!target) return;
            if (target.afterId === id) return;
            props.onMove(id, target.parentId, target.afterId);
          }}
          entry={entry}
          levelName={levels.find((l) => l.depth === entry.depth)?.name ?? `Level ${entry.depth + 1}`}
          formatName={templates.get(entry.block.formatId)?.name ?? "Unknown format"}
          structural={templates.get(entry.block.formatId)?.formatSettings?.structural ?? true}
          {...props}
          breakChip={breaks.get(entry.block.id) ?? null}
          words={totals.get(entry.block.id) ?? entry.block.wordCount}
          /**
           * Against its level's goal, when the level has one.
           *
           * Measured on the same total the card shows — the section and
           * everything under it — so the shading and the number agree. Only
           * structural blocks: a title page has no length to fall short of.
           */
          goal={
            structural(entry.block.id)
              ? (levels.find((l) => l.depth === entry.depth)?.wordGoal ?? null)
              : null
          }
          selected={entry.block.id === selectedId}
          isCollapsed={collapsed.has(entry.block.id)}
        />
        {dropLine && dropLine.afterVisible === entry.block.id ? dropRail(dropLine.depth) : null}
        </div>
      ))}
      <button className="outline-add" type="button" onClick={() => props.onAdd(null, "root")}>
        <Plus size={14} />
        Add block
      </button>
    </div>
  );
}

interface CardProps extends Omit<OutlinePanelProps, "collapsed"> {
  entry: OutlineEntry<Block>;
  levelName: string;
  formatName: string;
  /** False for a title page or a note: it isn't part of the level structure. */
  structural: boolean;
  /** The length this section is aiming at, or null when it isn't. */
  goal: number | null;
  selected: boolean;
  isCollapsed: boolean;
  draggable: boolean;
  isDragging: boolean;
  /** The card itself or something under it: the whole subtree moves together. */
  isLifted: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  /** Returns whether the drop would be accepted, so the cursor can say so. */
  onDragOverCard: (before: boolean) => boolean;
  onDropCard: (before: boolean) => void;
  breakChip: BreakChip | null;
  /** This block plus everything under it. */
  words: number;
}

function OutlineCard(props: CardProps) {
  const { entry, selected, isCollapsed } = props;
  const block = entry.block;
  const [menuOpen, setMenuOpen] = useState(false);
  const text = preview(block, props.templates.get(block.formatId));

  return (
    <div
      className={[
        "outline-item",
        props.breakChip ? "has-break" : "",
        props.isDragging ? "dragging" : "",
        props.isLifted ? "lifted" : "",
        props.goal ? (props.words >= props.goal ? "met" : "short") : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ marginLeft: entry.depth * 16 }}
      ref={(el) => props.registerRef(block.id, el)}
      draggable={props.draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(BLOCK_DRAG_TYPE, block.id);
        e.dataTransfer.effectAllowed = "move";
        props.onDragStart();
      }}
      onDragEnd={props.onDragEnd}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(BLOCK_DRAG_TYPE)) return;
        // Upper half inserts before, lower half after.
        const box = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < box.top + box.height / 2;
        if (!props.onDragOverCard(before)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(BLOCK_DRAG_TYPE)) return;
        e.preventDefault();
        const box = e.currentTarget.getBoundingClientRect();
        props.onDropCard(e.clientY < box.top + box.height / 2);
      }}
    >
      {props.breakChip ? (
        <button
          className={`outline-break${props.breakChip.detached ? " detached" : ""}`}
          type="button"
          title={
            props.breakChip.detached
              ? `${props.breakChip.templateName} — edited for this block. Moves with it.`
              : `${props.breakChip.templateName}. Attached to this block and moves with it.`
          }
          onClick={() => props.onSelectBreak(block.id)}
        >
          <Scissors size={11} />
          <span>{props.breakChip.templateName}</span>
        </button>
      ) : null}

    <div
      className={`outline-card${selected ? " selected" : ""}`}
    >
      {/* Two numbers when a block contains others: the whole of it on top, its
          own prose beneath. A leaf has only one, so it shows one. */}
      <div
        className="outline-gutter"
        title={
          entry.childCount > 0
            ? `${wordFmt.format(props.words)} words in all, ${wordFmt.format(
                block.wordCount,
              )} of them here`
            : `${wordFmt.format(block.wordCount)} words`
        }
      >
        <span className="og-total">{wordFmt.format(props.words)}</span>
        {entry.childCount > 0 ? (
          <span className="og-own">{wordFmt.format(block.wordCount)}</span>
        ) : null}
      </div>

      <button
        className="outline-body"
        type="button"
        onClick={() => props.onSelect(block.id)}
        onDoubleClick={() => props.onRename(block.id)}
      >
        <div className="outline-head">
          {entry.childCount > 0 ? (
            <span
              className="outline-twisty"
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleCollapse(block.id);
              }}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </span>
          ) : (
            <span className="outline-twisty spacerless" />
          )}
          <span className="outline-label">{block.label || <em>Untitled</em>}</span>
          {/* A non-structural block isn't at a level in any meaningful sense —
              it takes no break and no chapter number — so naming it by depth
              would be a lie. It says what it actually is. */}
          <span className="outline-level">
            {props.structural ? props.levelName : kindOf(props.formatName)}
          </span>
        </div>
        {text ? <p className="outline-preview">{text}</p> : null}
      </button>

      <div className="outline-menu-wrap">
        <button
          className="btn ghost outline-kebab"
          type="button"
          title="Block actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal size={15} />
        </button>
        {menuOpen ? (
          <>
            <div className="menu-scrim" role="presentation" onClick={() => setMenuOpen(false)} />
            <div className="menu" role="menu">
              <button type="button" onClick={() => { setMenuOpen(false); props.onAdd(block.id, "sibling-before"); }}>
                Add sibling before
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); props.onAdd(block.id, "sibling"); }}>
                Add sibling after
              </button>
              <button
                type="button"
                disabled={!props.structural}
                title={
                  props.structural
                    ? undefined
                    : `A ${props.formatName.toLowerCase()} isn't part of the structure, so it can't hold one`
                }
                onClick={() => { setMenuOpen(false); props.onAdd(block.id, "child"); }}
              >
                Add child
              </button>
              <button
                type="button"
                disabled={!block.parentId}
                onClick={() => { setMenuOpen(false); props.onAdd(block.id, "parent"); }}
              >
                Add one level up
              </button>
              <hr />
              <button type="button" onClick={() => { setMenuOpen(false); props.onRename(block.id); }}>
                Rename…
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); props.onEditFormat(block.id); }}>
                Edit this block&rsquo;s format…
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); props.onOptions(block.id); }}>
                Block options…
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => { setMenuOpen(false); props.onDelete(block.id); }}
              >
                Delete{entry.childCount > 0 ? " with children" : ""}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
    </div>
  );
}
