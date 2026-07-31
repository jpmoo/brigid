import { useState } from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus, Scissors } from "lucide-react";
import { subtreeWordCounts } from "@brigid/shared";
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
  onEditFormat: (id: string) => void;
  onOptions: (id: string) => void;
  onDelete: (id: string) => void;
  /** So the panel can scroll the current block into view as the document moves. */
  registerRef: (blockId: string, el: HTMLDivElement | null) => void;
}

export function OutlinePanel(props: OutlinePanelProps) {
  const { entries, templates, levels, selectedId, collapsed, breaks } = props;
  const totals = subtreeWordCounts(entries);

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
          structural={templates.get(entry.block.formatId)?.formatSettings?.structural ?? true}
          {...props}
          breakChip={breaks.get(entry.block.id) ?? null}
          words={totals.get(entry.block.id) ?? entry.block.wordCount}
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
  /** False for a title page or a note: it isn't part of the level structure. */
  structural: boolean;
  selected: boolean;
  isCollapsed: boolean;
  breakChip: BreakChip | null;
  /** This block plus everything under it. */
  words: number;
}

function OutlineCard(props: CardProps) {
  const { entry, selected, isCollapsed } = props;
  const block = entry.block;
  const [menuOpen, setMenuOpen] = useState(false);
  const text = preview(block);

  return (
    <div
      className={`outline-item${props.breakChip ? " has-break" : ""}`}
      style={{ marginLeft: entry.depth * 16 }}
      ref={(el) => props.registerRef(block.id, el)}
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
      className={`outline-card${selected ? " selected" : ""}${props.rendersInDocument ? "" : " note"}`}
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
            {props.structural ? props.levelName : props.formatName}
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
