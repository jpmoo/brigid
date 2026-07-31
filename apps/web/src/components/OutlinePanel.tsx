import { useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Scissors } from "lucide-react";
import type { OutlineEntry } from "@brigid/shared";
import type { Block, Placement, Template } from "../api.js";

const wordFmt = new Intl.NumberFormat();

/** Two lines of the block's prose, so a card is recognisable without opening it. */
function preview(block: Block): string {
  const text = block.contentText.trim();
  if (!text) return "";
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

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
  levels: { depth: number; name: string }[];
  selectedId: string | null;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onSelect: (id: string) => void;
  onAdd: (relativeTo: string | null, placement: Placement) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
}

export function OutlinePanel(props: OutlinePanelProps) {
  const { entries, templates, levels, selectedId, collapsed, breaks } = props;

  // A collapsed block hides its whole subtree, so hidden-ness is inherited.
  const hidden = new Set<string>();
  for (const entry of entries) {
    if (entry.ancestors.some((id) => collapsed.has(id) || hidden.has(id))) hidden.add(entry.block.id);
  }
  const visible = entries.filter((e) => !hidden.has(e.block.id));

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
    <div className="outline-list">
      {visible.map((entry) => (
        <OutlineCard
          key={entry.block.id}
          entry={entry}
          levelName={levels.find((l) => l.depth === entry.depth)?.name ?? `Level ${entry.depth + 1}`}
          formatName={templates.get(entry.block.formatId)?.name ?? "Unknown format"}
          rendersInDocument={
            templates.get(entry.block.formatId)?.formatSettings?.rendersInDocument ?? true
          }
          {...props}
          breakChip={breaks.get(entry.block.id) ?? null}
          selected={entry.block.id === selectedId}
          isCollapsed={collapsed.has(entry.block.id)}
        />
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
  rendersInDocument: boolean;
  selected: boolean;
  isCollapsed: boolean;
  breakChip: BreakChip | null;
}

function OutlineCard(props: CardProps) {
  const { entry, selected, isCollapsed } = props;
  const block = entry.block;
  const [menuOpen, setMenuOpen] = useState(false);
  const text = preview(block);

  return (
    <div className="outline-item" style={{ marginLeft: entry.depth * 16 }}>
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
      className={`outline-card${selected ? " selected" : ""}${props.rendersInDocument ? "" : " note"}`}
    >
      <div className="outline-gutter" title={`${wordFmt.format(block.wordCount)} words`}>
        {wordFmt.format(block.wordCount)}
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
          <span className="outline-level">{props.levelName}</span>
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
              <button type="button" onClick={() => { setMenuOpen(false); props.onAdd(block.id, "sibling"); }}>
                Add sibling after
              </button>
              <button type="button" onClick={() => { setMenuOpen(false); props.onAdd(block.id, "child"); }}>
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
