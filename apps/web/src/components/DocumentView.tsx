import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import { Bookmark as BookmarkIcon, Pencil } from "lucide-react";
import { asProseDoc, hasMark, proseParagraphs, smartenText } from "@brigid/shared";
import { BOOKMARK_DRAG_TYPE } from "./BookmarkStrip.js";
import type { DocumentItem, ProseText, ResolvedNode, ResolvedSpan, Typography } from "@brigid/shared";
import type { Block } from "../api.js";

/**
 * Book is comfortable and book-like; Manuscript sets the page exactly as the
 * templates specify. Both are editable — the mode is presentation only.
 */
export type ViewMode = "book" | "manuscript";

/** Fixed: long enough not to feel cramped, short enough to read comfortably. */
export const BOOK_MEASURE_CH = 85;

function spanStyle(span: ResolvedSpan): CSSProperties {
  return {
    fontWeight: span.bold ? 700 : undefined,
    fontStyle: span.italic ? "italic" : undefined,
    fontVariant: span.smallCaps ? "small-caps" : undefined,
    textTransform: span.allCaps ? "uppercase" : undefined,
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
function highlight(text: string, needle: string, counter: { n: number }, activeIndex: number | null) {
  if (!needle) return text;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    if (at > from) parts.push(text.slice(from, at));
    const ordinal = counter.n;
    counter.n += 1;
    parts.push(
      <mark className={ordinal === activeIndex ? "hit active" : "hit"} key={`${at}-${ordinal}`}>
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  if (parts.length === 0) return text;
  if (from < text.length) parts.push(text.slice(from));
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
  editing = false,
  editor,
  onEditProse,
}: {
  nodes: ResolvedNode[];
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
  editing?: boolean;
  editor?: ReactNode;
  onEditProse?: () => void;
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
            if (editing) return <Fragment key={i}>{editor}</Fragment>;

            const doc = asProseDoc(proseDoc);
            const paragraphs: ProseText[][] = doc
              ? proseParagraphs(doc)
              : prose
                ? prose.split(/\n{2,}/).map((text) => [{ type: "text" as const, text }])
                : [];
            const written = paragraphs.some((runs) => runs.some((r) => r.text.trim()));

            return written ? (
              <Fragment key={i}>
                {paragraphs.map((runs, j) => (
                  <p
                    className={j === 0 && !indentFirst ? "prose flush" : "prose"}
                    key={j}
                    style={
                      indent !== undefined && !(j === 0 && !indentFirst)
                        ? { textIndent: indent }
                        : undefined
                    }
                    onDoubleClick={onEditProse}
                  >
                    {runs.map((run, k) => {
                      const text = smart ? smartenText(run.text) : run.text;
                      const marked = highlight(text, search, counter, activeIndex);
                      if (!hasMark(run, "strong") && !hasMark(run, "em")) {
                        return <Fragment key={k}>{marked}</Fragment>;
                      }
                      const inner = hasMark(run, "em") ? <em>{marked}</em> : marked;
                      return hasMark(run, "strong") ? (
                        <strong key={k}>{inner}</strong>
                      ) : (
                        <Fragment key={k}>{inner}</Fragment>
                      );
                    })}
                  </p>
                ))}
              </Fragment>
            ) : (
              <p className="prose empty" key={i} onDoubleClick={onEditProse}>
                Nothing written here yet.
              </p>
            );
          }
        }
      })}
    </>
  );
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
  bookmarkedBlockIds: Set<string>;
  onDropBookmark: (blockId: string) => void;
  /** Lowercased needle, or empty when not searching. */
  search: string;
  activeMatch: { blockId: string; indexInBlock: number } | null;
  /** The block whose prose is open for editing, if any. */
  editingId: string | null;
  /**
   * Asked when a block's prose is double-clicked. Only offered for blocks whose
   * format has a content node — a title page is composed of template lines and
   * is edited in its format, not on the page.
   */
  onEditProse: (blockId: string) => void;
  editor: ReactNode;
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
  bookmarkedBlockIds,
  onDropBookmark,
  search,
  activeMatch,
  editingId,
  onEditProse,
  editor,
}: DocumentViewProps) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);

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
            }${bookmarkedBlockIds.has(item.block.id) ? " bookmarked" : ""}`}
            key={item.block.id}
            data-block-id={item.block.id}
            ref={(el) => registerRef(item.block.id, el)}
            onClick={() => onSelect(item.block.id)}
            role="presentation"
            style={typographyStyle(item.typography, mode)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(BOOKMARK_DRAG_TYPE)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDropTarget(item.block.id);
            }}
            onDragLeave={() => setDropTarget((c) => (c === item.block.id ? null : c))}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes(BOOKMARK_DRAG_TYPE)) return;
              e.preventDefault();
              setDropTarget(null);
              onDropBookmark(item.block.id);
            }}
          >
            {bookmarkedBlockIds.has(item.block.id) ? (
              <span className="doc-bookmark" title="Bookmarked">
                <BookmarkIcon size={13} />
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
              prose={item.block.contentText}
              editing={editingId === item.block.id}
              editor={editor}
              onEditProse={() => onEditProse(item.block.id)}
              indentFirst={item.firstLineIndent}
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
