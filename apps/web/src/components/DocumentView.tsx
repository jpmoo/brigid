import { Fragment } from "react";
import type { CSSProperties } from "react";
import { Pencil } from "lucide-react";
import type { DocumentItem, ResolvedNode, ResolvedSpan, Typography } from "@brigid/shared";
import type { Block } from "../api.js";

/**
 * Book is comfortable and book-like; Manuscript sets the page exactly as the
 * templates specify. Both are editable — the mode is presentation only.
 */
export type ViewMode = "book" | "manuscript";

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

function Nodes({
  nodes,
  prose,
  indentFirst = true,
  mode,
  typography,
}: {
  nodes: ResolvedNode[];
  prose?: string;
  indentFirst?: boolean;
  mode: ViewMode;
  typography: Typography | null;
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
                          }}
                        >
                          {cell.spans.map((span, si) => (
                            <span
                              key={si}
                              className={span.placeholder ? "placeholder-var" : undefined}
                              style={spanStyle(span)}
                            >
                              {span.tab ? "\u0009" : span.text}
                            </span>
                          ))}
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
                style={mode === "manuscript" ? { textAlign: node.align } : undefined}
              >
                {node.spans.map((span, j) =>
                  span.tab ? (
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
          case "content":
            return prose ? (
              <Fragment key={i}>
                {prose.split(/\n{2,}/).map((para, j) => (
                  <p
                    className={j === 0 && !indentFirst ? "prose flush" : "prose"}
                    key={j}
                    style={
                      indent !== undefined && !(j === 0 && !indentFirst)
                        ? { textIndent: indent }
                        : undefined
                    }
                  >
                    {para}
                  </p>
                ))}
              </Fragment>
            ) : (
              <p className="prose empty" key={i}>
                Nothing written here yet.
              </p>
            );
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
  /**
   * Book-mode line length, in characters. Null fills the viewport. Manuscript
   * ignores it — its whole point is fidelity to the page it will be set on.
   */
  measureCh: number | null;
}

export function DocumentView({
  items,
  registerRef,
  selectedId,
  onSelect,
  mode,
  onEditBreak,
  measureCh,
}: DocumentViewProps) {
  const sheetStyle: CSSProperties =
    mode === "book" && measureCh !== null ? { maxWidth: `${measureCh}ch` } : {};

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
            ref={(el) => registerRef(breakRefKey(item.blockId), el)}
          >
            <div className="doc-break-body" style={typographyStyle(item.typography, mode)}>
              <Nodes nodes={item.nodes} mode={mode} typography={item.typography} />
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
            className={`doc-block${item.block.id === selectedId ? " selected" : ""}`}
            key={item.block.id}
            ref={(el) => registerRef(item.block.id, el)}
            onClick={() => onSelect(item.block.id)}
            role="presentation"
            style={typographyStyle(item.typography, mode)}
          >
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
              prose={item.block.contentText}
              indentFirst={item.firstLineIndent}
              mode={mode}
              typography={item.typography}
            />
          </div>
        ),
      )}
    </div>
  );
}
