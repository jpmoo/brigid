import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import { Bookmark as BookmarkIcon, Pencil } from "lucide-react";
import {
  asProseDoc,
  foldForSearchMapped,
  hasMark,
  proseParagraphs,
  smartenText,
} from "@brigid/shared";
import { BOOKMARK_DRAG_TYPE } from "./BookmarkStrip.js";
import { offsetOfPoint, offsetOfPosition, paragraphUnder } from "./ProseEditor.js";
import { words } from "../spelling.js";
import type { Speller } from "../spelling.js";
import type { ProseLayout } from "./ProseEditor.js";
import type { DocumentItem, ProseText, ResolvedNode, ResolvedSpan, Typography } from "@brigid/shared";
import type { Block } from "../api.js";

/**
 * Book is comfortable and book-like; Manuscript sets the page exactly as the
 * templates specify. Both are editable — the mode is presentation only.
 */
/**
 * How the manuscript is being looked at.
 *
 * The first two are the same document set differently. The canvas is a
 * different shape entirely — nested regions on an endless surface — but the
 * same book underneath, which is why it is a mode rather than a page.
 */
export type ViewMode = "book" | "manuscript" | "canvas";

/** Fixed: long enough not to feel cramped, short enough to read comfortably. */
export const BOOK_MEASURE_CH = 85;

function spanStyle(span: ResolvedSpan): CSSProperties {
  return {
    fontWeight: span.bold ? 700 : undefined,
    fontStyle: span.italic ? "italic" : undefined,
    textDecoration: span.underline ? "underline" : undefined,
    fontVariant: span.smallCaps ? "small-caps" : undefined,
    // Small caps win if both somehow survive: uppercasing first would leave
    // small caps nothing lowercase to work on, so it would silently do nothing.
    textTransform: span.allCaps && !span.smallCaps ? "uppercase" : undefined,
    letterSpacing: span.smallCaps || span.allCaps ? "0.08em" : undefined,
  };
}

/**
 * Typography is the template's, not the app's — nothing about Courier or double
 * spacing is baked in here. Book mode ignores it entirely and inherits the
 * sheet's own type.
 */
function typographyStyle(t: Typography | null, mode: ViewMode): CSSProperties {
  if (mode !== "manuscript" || !t) return {};
  return {
    fontFamily: t.fontFamily,
    fontSize: t.fontSizePt ? `${t.fontSizePt}pt` : undefined,
    fontWeight: t.fontWeight,
    fontStyle: t.italic ? "italic" : undefined,
    lineHeight: t.lineHeight,
    textAlign: t.align,
    tabSize: t.tabStopIn ? `${t.tabStopIn}in` : undefined,
  };
}

/**
 * Split a paragraph on the search term, tagging each hit with its ordinal
 * within the block so the active one can be picked out from the rest.
 */
/**
 * The words a checker doesn't know, marked in prose nobody is editing.
 *
 * Only the parts of a line that aren't already a search hit: a hit is its own
 * mark, and two overlaid would say less than either. The checker's answers are
 * remembered per word, because this runs over the whole manuscript rather than
 * the block being written in.
 */
function misspellings(text: string, speller: Speller | null, key: string): ReactNode {
  if (!speller || !text) return text;

  const parts: ReactNode[] = [];
  let from = 0;
  for (const { word, at } of words(text)) {
    if (speller.correct(word)) continue;
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <span className="misspelled" key={`${key}-${at}`}>
        {word}
      </span>,
    );
    from = at + word.length;
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

function highlight(
  text: string,
  needle: string,
  counter: { n: number },
  activeIndex: number | null,
  speller: Speller | null = null,
) {
  if (!needle) return misspellings(text, speller, "s");
  const parts: ReactNode[] = [];

  // Searched folded, shown unfolded: the reader keeps the typeset punctuation
  // while the match is found however it was typed. The fold carries a note of
  // where each character came from, because one of the substitutions — the
  // ellipsis, one character standing for three — moves every offset after it.
  const folded = foldForSearchMapped(text);
  let searched = 0;
  let shown = 0;

  for (;;) {
    const found = folded.text.indexOf(needle, searched);
    if (found === -1) break;

    const start = folded.at[found] ?? text.length;
    const end = folded.at[found + needle.length] ?? text.length;
    if (start > shown) parts.push(misspellings(text.slice(shown, start), speller, `s${shown}`));

    const ordinal = counter.n;
    counter.n += 1;
    // Make the active hit focusable so browsers scroll inline elements reliably.
    // Inline <mark> does not have consistent scrollIntoView rects across engines,
    // but document.querySelector() → .focus() works everywhere the text is actually rendered.
    const isActive = ordinal === activeIndex;
    parts.push(
      <mark
        className={isActive ? "hit active" : "hit"}
        tabIndex={isActive ? -1 : undefined}
        key={`${start}-${ordinal}`}
      >
        {text.slice(start, end)}
      </mark>,
    );

    searched = found + needle.length;
    shown = end;
  }

  if (parts.length === 0) return misspellings(text, speller, "s");
  if (shown < text.length) parts.push(misspellings(text.slice(shown), speller, `s${shown}`));
  return parts;
}

function Nodes({
  nodes,
  prose,
  proseDoc,
  indentFirst = true,
  mode,
  typography,
  search,
  activeIndex,
  counter,
  smart = false,
  speller = null,
  editing = false,
  editor,
  onEditProse,
  onOpenBookmark,
  onCarry,
  bookmarks = [],
}: {
  nodes: ResolvedNode[];
  /** This block's bookmarks, so the ones naming a line can sit beside it. */
  bookmarks?: { id: string; name: string; description: string | null; paragraphIndex: number | null }[];
  prose?: string;
  /** The structured prose, when the block has it. Carries bold and italic. */
  proseDoc?: Record<string, unknown> | null;
  indentFirst?: boolean;
  mode: ViewMode;
  typography: Typography | null;
  search: string;
  activeIndex: number | null;
  counter: { n: number };
  smart?: boolean;
  /** Null when checking is off, or before the dictionary has arrived. */
  speller?: Speller | null;
  editing?: boolean;
  editor?: (layout: ProseLayout) => ReactNode;
  onEditProse?: (selection: { anchor: number; focus: number }, askAbout?: string) => void;
  onOpenBookmark?: ((bookmarkId: string) => void) | undefined;
  /** Picked up, or put down. The block is the caller's to supply. */
  onCarry?: ((bookmarkId: string | null) => void) | undefined;
}) {
  const indent =
    mode === "manuscript" && typography?.firstLineIndentIn !== undefined
      ? `${typography.firstLineIndentIn}in`
      : undefined;

  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "pageBreak":
            return <div className="page-break" key={i} aria-label="Page break" />;
          case "spacer":
            return <div className="spacer-lines" key={i} style={{ height: `${node.lines * 1.5}em` }} />;
          case "table": {
            const total = node.columns.reduce((sum, c) => sum + (c.width || 0), 0) || 1;
            const b = node.borders;
            const rule = `${b.widthPt ?? 1}pt solid currentColor`;
            return (
              <table
                className="tpl-table"
                key={i}
                style={{ border: b.outer ? rule : undefined }}
              >
                <colgroup>
                  {node.columns.map((c, ci) => (
                    <col key={ci} style={{ width: `${((c.width || 0) / total) * 100}%` }} />
                  ))}
                </colgroup>
                <tbody>
                  {node.rows.map((row, ri) => (
                    <tr key={ri} style={{ borderTop: b.rows && ri > 0 ? rule : undefined }}>
                      {row.cells.map((cell, ci) => (
                        <td
                          key={ci}
                          style={{
                            textAlign: cell.align ?? node.columns[ci]?.align ?? "left",
                            borderLeft: b.columns && ci > 0 ? rule : undefined,
                            verticalAlign: cell.verticalAlign ?? "top",
                            lineHeight: cell.lineHeight,
                            fontSize: cell.fontSizePt ? `${cell.fontSizePt}pt` : undefined,
                            fontFamily: cell.fontFamily,
                          }}
                        >
                          {cell.spans.map((span, si) =>
                            span.lineBreak ? (
                              <br key={si} />
                            ) : (
                              <span
                                key={si}
                                className={span.placeholder ? "placeholder-var" : undefined}
                                style={spanStyle(span)}
                              >
                                {span.tab ? "\u0009" : span.text}
                              </span>
                            ),
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
          case "paragraph":
            return (
              <p
                className={`tpl-para align-${node.align}`}
                key={i}
                style={{
                  ...(mode === "manuscript" ? { textAlign: node.align } : {}),
                  ...(node.lineHeight ? { lineHeight: node.lineHeight } : {}),
                  ...(node.fontSizePt ? { fontSize: `${node.fontSizePt}pt` } : {}),
                  ...(node.fontFamily ? { fontFamily: node.fontFamily } : {}),
                }}
              >
                {node.spans.map((span, j) =>
                  span.lineBreak ? (
                    <br key={j} />
                  ) : span.tab ? (
                    <span className="tpl-tab" key={j} />
                  ) : (
                    <span
                      key={j}
                      className={span.placeholder ? "placeholder-var" : undefined}
                      style={spanStyle(span)}
                    >
                      {span.text}
                    </span>
                  ),
                )}
              </p>
            );
          case "content": {
            // A content node is what makes a block writable. The title page has
            // none — it is composed of template lines — so it is not editable
            // here, without that needing to be said anywhere as a special case.
            if (editing) {
              return (
                <Fragment key={i}>
                  {editor?.({ indent, indentFirst })}
                </Fragment>
              );
            }

            const doc = asProseDoc(proseDoc);
            const paragraphs: ProseText[][] = doc
              ? proseParagraphs(doc)
              : prose
                ? prose.split(/\n{2,}/).map((text) => [{ type: "text" as const, text }])
                : [];
            const quoted = doc ? doc.content.map((p) => p.blockquote === true) : [];
            const written = paragraphs.some((runs) => runs.some((r) => r.text.trim()));

            /**
              * On release, not on press.
              *
              * Pressing would be the obvious hook, but a drag-selection is bound
              * to the node under the pointer when the press lands — swap that
              * node for the editor at that moment and the browser has nothing
              * left to extend a selection from. So the rendered text does the
              * selecting, natively, with all the behaviour that comes free with
              * it, and what it produced is carried across the swap here.
              *
              * Released, rather than clicked: a click only fires when the press
              * and release share an ancestor, which a drag ending outside the
              * block does not.
              *
              * A pointer release rather than a mouse one, so a finger counts.
              * iOS only synthesizes mouse events for what it decides is
              * interactive, and prose is not on its list — tapping a paragraph
              * would have done nothing at all. Pointer events also draw the
              * right distinction for touch: lifting after a tap or a drag-select
              * is a release, while lifting after a scroll is a cancel.
              */
            const enter = (event: React.PointerEvent<HTMLElement>) => {
              if (!onEditProse) return;
              // The block beneath has its own click; writing where the pointer
              // is should not also be a click on the block.
              event.stopPropagation();

              // Clicking an underlined word is a question about that word, so
              // the editor opens with the suggestions already showing rather
              // than making the writer find and click it a second time.
              const flagged = (event.target as HTMLElement).closest(".misspelled");
              const word = flagged?.textContent ?? undefined;
              // Read now: the event's own properties don't survive the wait.
              const root = event.currentTarget;
              const { clientX, clientY } = event;

              /**
               * Whatever was last selected here, not whatever is selected now.
               *
               * Reading the live selection cannot be made to work by choosing a
               * better moment, because there is no good moment. At `pointerup`
               * the browser has not finished settling the drag — that happens
               * between there and `mouseup` — and by the next animation frame
               * the trailing `click` has collapsed it to a caret. Both events
               * are in the same task, so deferring steps over the finalised
               * selection and lands after it has been destroyed.
               *
               * So the selection is remembered as it is made, by a
               * `selectionchange` listener, and read from there. Nothing here
               * depends on the order pointer, mouse and click events arrive in.
               */
              /**
               * Only a selection made inside this block, during this press.
               * Anything remembered from before the pointer went down belongs
               * to a drag already finished with, and a plain click on a block
               * should put the caret where it was clicked rather than restoring
               * whatever was highlighted a minute ago.
               */
              const held = lastSelection.current;
              const carried =
                held &&
                held.root === root &&
                pressedAt.current !== null &&
                held.at >= pressedAt.current
                  ? { anchor: held.anchor, focus: held.focus }
                  : null;

              onEditProse(carried ?? pointIn(root, clientX, clientY), word);
            };

            return written ? (
              <div
                className="prose-body"
                key={i}
                /* Marks this element as one the selection watcher should claim
                   a drag for, and gives it something to compare roots against. */
                data-prose-root=""
                onPointerDown={() => {
                  watchSelection();
                  pressedAt.current = Date.now();
                }}
                onPointerUp={enter}
              >
                {paragraphs.map((runs, j) => {
                  // An extract is inset as a whole and never carries a
                  // first-line indent, whatever the block's setting.
                  const isQuote = quoted[j] === true;
                  const flush = isQuote || (j === 0 && !indentFirst);
                  const here = bookmarks.filter((b) => b.paragraphIndex === j);
                  return (
                  <p
                    className={`prose${flush && !isQuote ? " flush" : ""}${isQuote ? " blockquote" : ""}${
                      here.length > 0 ? " has-bookmark" : ""
                    }`}
                    key={j}
                    style={indent !== undefined && !flush ? { textIndent: indent } : undefined}
                  >
                    {/* Beside the line it marks, rather than at the top of the
                        section — which is the whole point of storing a line. */}
                    {here.length > 0 ? (
                      <span className="doc-bookmarks" contentEditable={false}>
                        {here.map((b) => (
                          <span
                            className="doc-bookmark"
                            key={b.id}
                            draggable
                            onDragEnd={() => onCarry?.(null)}
                            onDragStart={(e) => {
                              onCarry?.(b.id);
                              e.dataTransfer.setData(BOOKMARK_DRAG_TYPE, b.id);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            title={b.description ? `${b.name}\n\n${b.description}` : b.name}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              onOpenBookmark?.(b.id);
                            }}
                          >
                            <BookmarkIcon size={13} fill="currentColor" />
                          </span>
                        ))}
                      </span>
                    ) : null}
                    {runs.map((run, k) => {
                      const text = smart ? smartenText(run.text) : run.text;
                      const marked = highlight(text, search, counter, activeIndex, speller);
                      if (
                        !hasMark(run, "strong") &&
                        !hasMark(run, "em") &&
                        !hasMark(run, "underline")
                      ) {
                        return <Fragment key={k}>{marked}</Fragment>;
                      }
                      const underlined = hasMark(run, "underline") ? <u>{marked}</u> : marked;
                      const inner = hasMark(run, "em") ? <em>{underlined}</em> : underlined;
                      return hasMark(run, "strong") ? (
                        <strong key={k}>{inner}</strong>
                      ) : (
                        <Fragment key={k}>{inner}</Fragment>
                      );
                    })}
                  </p>
                  );
                })}
              </div>
            ) : (
              <p className="prose empty" key={i} onPointerUp={enter}>
                Nothing written here yet.
              </p>
            );
          }
        }
      })}
    </>
  );
}

/**
 * What is selected inside a block's rendered prose, as character offsets.
 *
 * Falls back to the point released on when there is nothing usable — a plain
 * click, or a selection that started outside this block. Anchor and focus are
 * kept in the order the writer made them, so a backwards drag stays backwards
 * and the next shift-arrow extends from the end they were moving.
 *
 * A selection running past the block is kept only as far as the block goes.
 * Each block is its own editor, so there is no other honest answer; the part
 * outside cannot be edited here whatever we do with it.
 */
/**
 * The last selection the writer actually made, and when.
 *
 * Module-level because there is only ever one selection in a document, and a
 * single listener is cheaper than one per block. `selectionchange` fires while
 * the drag is happening — well before the pointer is released and long before
 * the click that collapses it — so this holds the real thing at a moment when
 * nothing has yet had a chance to destroy it.
 */
const lastSelection: {
  current: { root: HTMLElement; anchor: number; focus: number; at: number } | null;
} = { current: null };

/** When the current press began, so a remembered selection can be dated. */
const pressedAt: { current: number | null } = { current: null };

let watching = false;

/**
 * Start remembering, once.
 *
 * The listener asks each prose root whether the selection is inside it, which
 * is cheap: the selection either is or is not within a given element, and the
 * first one that claims it wins.
 */
function watchSelection(): void {
  if (watching || typeof document === "undefined") return;
  watching = true;

  document.addEventListener("selectionchange", () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const node = selection.anchorNode;
    if (!node) return;
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
    const root = element?.closest<HTMLElement>("[data-prose-root]");
    if (!root) return;

    const held = liveSelection(root);
    if (held) lastSelection.current = { root, ...held, at: Date.now() };
  });
}

/** A plain click: the caret goes where the pointer was released. */
function pointIn(root: HTMLElement, x: number, y: number): { anchor: number; focus: number } {
  const at = offsetOfPoint(root, x, y);
  return { anchor: at, focus: at };
}

/**
 * The live selection, converted to offsets, if it lies inside this block.
 *
 * Null when there is nothing usable — no selection, a collapsed one, or one
 * that started outside. A selection running past the block is kept only as far
 * as the block goes: each block is its own editor, so there is no other honest
 * answer, and the part outside cannot be edited here whatever is done with it.
 *
 * Anchor and focus stay in the order the writer made them, so a backwards drag
 * stays backwards and the next shift-arrow extends from the end they were on.
 */
function liveSelection(root: HTMLElement): { anchor: number; focus: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !focusNode) return null;
  if (!root.contains(anchorNode) || !root.contains(focusNode)) return null;

  const anchor = offsetOfPosition(root, anchorNode, selection.anchorOffset);
  const focus = offsetOfPosition(root, focusNode, selection.focusOffset);
  return anchor !== null && focus !== null ? { anchor, focus } : null;
}

/** Breaks register under this key so the outline can scroll to one. */
export const breakRefKey = (blockId: string) => `break:${blockId}`;

export interface DocumentViewProps {
  items: DocumentItem<Block>[];
  registerRef: (key: string, el: HTMLDivElement | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  mode: ViewMode;
  onEditBreak: (blockId: string) => void;
  /** Zoom applied to the whole sheet, so manuscript keeps its pt fidelity. */
  textScale: number;
  /**
   * The manuscript's body type. Lines that set nothing of their own inherit
   * this rather than the app's interface font.
   */
  baseTypography: Typography | null;
  /** Every bookmark on a block, oldest first — they stack in the margin. */
  bookmarksByBlock: Map<
    string,
    { id: string; name: string; description: string | null; paragraphIndex: number | null }[]
  >;
  onDropBookmark: (blockId: string, paragraph?: { index: number; text: string }) => void;
  /** Double-clicking a marker: the bookmark opens for editing. */
  onOpenBookmark: (bookmarkId: string) => void;
  /** A marker dragged onto another paragraph, possibly in another section. */
  onMoveBookmark: (
    bookmarkId: string,
    blockId: string,
    paragraph?: { index: number; text: string },
  ) => void;
  /** Lowercased needle, or empty when not searching. */
  search: string;
  activeMatch: { blockId: string; indexInBlock: number } | null;
  /** Marks what the checker doesn't know, in prose nobody is editing. */
  speller: Speller | null;
  /** The block whose prose is open for editing, if any. */
  editingId: string | null;
  /**
   * Asked when a block's prose is released on, with whatever was selected so
   * the editor can open holding it. Only offered for blocks whose format has a
   * content node — a title page is composed of template lines and is edited in
   * its format, not on the page.
   */
  onEditProse: (
    blockId: string,
    selection: { anchor: number; focus: number },
    /** Set when the click landed on an underlined word, which asks about it. */
    askAbout?: string,
  ) => void;
  /**
   * Given the paragraph setting of the block being edited, since only the
   * renderer knows it — it depends on the view mode and on the break above.
   */
  editor: (layout: ProseLayout) => ReactNode;
}

export function DocumentView({
  items,
  registerRef,
  selectedId,
  onSelect,
  mode,
  onEditBreak,
  textScale,
  baseTypography,
  bookmarksByBlock,
  onDropBookmark,
  onOpenBookmark,
  onMoveBookmark,
  search,
  activeMatch,
  speller,
  editingId,
  onEditProse,
  editor,
}: DocumentViewProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  /**
   * Which bookmark is in the air, and which section it belongs to.
   *
   * Held here rather than read from the drag itself: `dataTransfer` is
   * deliberately unreadable during a dragover, so a section cannot ask what is
   * being carried at the moment it has to decide whether to accept it. Set when
   * a marker is picked up, cleared when it lands.
   */
  const [carrying, setCarrying] = useState<{ id: string; blockId: string } | null>(null);

  /**
   * A bookmark moves between the paragraphs of its own section and no further.
   * It marks a place in a particular piece of writing; carried into another
   * section it would be marking a place it had never been, so the drop is
   * refused rather than quietly re-homed.
   */
  const acceptsDrop = (blockId: string) => !carrying || carrying.blockId === blockId;

  /**
   * Which section a bookmark currently belongs to, looked up rather than
   * remembered.
   *
   * `carrying` is only ever an affordance — it decides the cursor during a
   * dragover, and it is not always set, because a marker picked up inside the
   * editor is markup the editor drew and never passes through here. The drop
   * itself has to be decided on something that is true whatever the drag came
   * from, so it is decided on this.
   */
  const ownerOf = (bookmarkId: string): string | undefined => {
    for (const [blockId, list] of bookmarksByBlock) {
      if (list.some((b) => b.id === bookmarkId)) return blockId;
    }
    return undefined;
  };

  // Book holds a fixed 85-character measure — long enough not to feel cramped,
  // short enough to read. Manuscript fills the viewport, since fidelity to the
  // page it will be set on is the whole point.
  //
  // `zoom` rather than a font-size override, so manuscript's point sizes keep
  // their ratios to each other instead of being flattened.
  const sheetStyle: CSSProperties = {
    zoom: textScale,
    ...(mode === "book" ? { maxWidth: `${BOOK_MEASURE_CH}ch` } : {}),
    ...(mode === "manuscript" ? typographyStyle(baseTypography, mode) : {}),
  };

  if (items.length === 0) {
    return (
      <div className={`page-sheet ${mode}`} style={sheetStyle}>
        <p className="prose empty">This manuscript is empty. Add a block in the outline to begin.</p>
      </div>
    );
  }

  return (
    <div className={`page-sheet ${mode}`} style={sheetStyle}>
      {items.map((item, i) =>
        item.kind === "break" ? (
          // A break lives between blocks and belongs to neither, so it carries
          // its own affordance rather than hiding inside a block's menu.
          <div
            className={`doc-break${item.detached ? " detached" : ""}`}
            key={`b${i}`}
            data-break-for={item.blockId}
            ref={(el) => registerRef(breakRefKey(item.blockId), el)}
          >
            <div className="doc-break-body" style={typographyStyle(item.typography, mode)}>
              <Nodes
                nodes={item.nodes}
                mode={mode}
                typography={item.typography}
                search=""
                activeIndex={null}
                counter={{ n: 0 }}
              />
            </div>
            <button
              className="doc-break-edit"
              type="button"
              title={
                item.detached
                  ? `${item.templateName} — edited for this block`
                  : `${item.templateName} — click to edit just this one`
              }
              onClick={() => onEditBreak(item.blockId)}
            >
              <Pencil size={12} />
              <span>{item.templateName}</span>
            </button>
          </div>
        ) : (
          <div
            className={`doc-block${item.block.id === selectedId ? " selected" : ""}${
              dropTarget === item.block.id ? " drop-target" : ""
            }${bookmarksByBlock.has(item.block.id) ? " bookmarked" : ""}`}
            key={item.block.id}
            data-block-id={item.block.id}
            ref={(el) => registerRef(item.block.id, el)}
            onClick={() => onSelect(item.block.id)}
            role="presentation"
            style={typographyStyle(item.typography, mode)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(BOOKMARK_DRAG_TYPE)) return;
              if (!acceptsDrop(item.block.id)) {
                // Not prevented, so the drop is simply never offered here —
                // which is what makes the pointer say no rather than the drop
                // being taken and then discarded.
                e.dataTransfer.dropEffect = "none";
                return;
              }
              e.preventDefault();
              // The payload is unreadable until the drop, so the effect is
              // "move" throughout: a marker being carried is the common case,
              // and a new one arriving from the strip reads fine as either.
              e.dataTransfer.dropEffect = "move";
              setDropTarget(item.block.id);
            }}
            onDragLeave={() => setDropTarget((c) => (c === item.block.id ? null : c))}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes(BOOKMARK_DRAG_TYPE)) return;
              e.preventDefault();
              setDropTarget(null);
              setCarrying(null);
              // The strip sends "new"; a marker already in the manuscript sends
              // its own id and is moved rather than duplicated.
              const carried = e.dataTransfer.getData(BOOKMARK_DRAG_TYPE);
              const at = paragraphUnder(e.currentTarget, e.clientY);
              if (!carried || carried === "new") {
                onDropBookmark(item.block.id, at);
                return;
              }
              // Its own section only. A bookmark marks a place in a particular
              // piece of writing; carried into another it would be marking a
              // place it had never been.
              if (ownerOf(carried) !== item.block.id) return;
              onMoveBookmark(carried, item.block.id, at);
            }}
          >
            {(bookmarksByBlock.get(item.block.id) ?? []).some((b) => b.paragraphIndex === null) ? (
              /* Only the ones marking the section as a whole. Anything naming a
                 line is drawn beside that line instead. Stacked oldest at the
                 top: the order they were made is the only order that means
                 anything, and it keeps a marker from moving when a newer one
                 appears below it. */
              <span className="doc-bookmarks">
                {bookmarksByBlock
                  .get(item.block.id)
                  ?.filter((b) => b.paragraphIndex === null)
                  .map((b) => (
                  <span
                    className="doc-bookmark"
                    key={b.id}
                    draggable
                    onDragEnd={() => setCarrying(null)}
                    onDragStart={(e) => {
                      // Its own id rather than "new": the drop moves this one
                      // instead of making another.
                      setCarrying({ id: b.id, blockId: item.block.id });
                      e.dataTransfer.setData(BOOKMARK_DRAG_TYPE, b.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    title={b.description ? `${b.name}\n\n${b.description}` : b.name}
                    onDoubleClick={(e) => {
                      // Or the double-click would also land in the prose behind
                      // it and open the section for editing.
                      e.stopPropagation();
                      onOpenBookmark(b.id);
                    }}
                  >
                    <BookmarkIcon size={13} fill="currentColor" />
                  </span>
                  ))}
              </span>
            ) : null}
            {item.sectionStart ? (
              <div className="section-marker" title="Starts a new page-numbering section">
                {item.sectionStart.pageNumbering === "restart"
                  ? `page count restarts at ${item.sectionStart.startPageNumber ?? 1}`
                  : "new section"}
                {item.sectionStart.runningHeads === "suppress" ? " · no running heads" : ""}
              </div>
            ) : null}
            <Nodes
              nodes={item.nodes}
              proseDoc={item.block.content}
              bookmarks={bookmarksByBlock.get(item.block.id)}
              speller={speller}
              prose={item.block.contentText}
              editing={editingId === item.block.id}
              editor={editor}
              onEditProse={(selection, askAbout) =>
                onEditProse(item.block.id, selection, askAbout)
              }
              indentFirst={item.firstLineIndent}
              onOpenBookmark={onOpenBookmark}
              onCarry={(bookmarkId) =>
                setCarrying(bookmarkId ? { id: bookmarkId, blockId: item.block.id } : null)
              }
              mode={mode}
              typography={item.typography}
              search={search}
              activeIndex={
                activeMatch?.blockId === item.block.id ? activeMatch.indexInBlock : null
              }
              counter={{ n: 0 }}
              smart={item.smartPunctuation}
            />
          </div>
        ),
      )}
    </div>
  );
}
