import { Fragment } from "react";
import type { CSSProperties } from "react";
import type { DocumentItem, ResolvedNode, ResolvedSpan } from "@brigid/shared";
import type { Block } from "../api.js";

function spanStyle(span: ResolvedSpan): CSSProperties {
  return {
    fontWeight: span.bold ? 700 : undefined,
    fontStyle: span.italic ? "italic" : undefined,
    fontVariant: span.smallCaps ? "small-caps" : undefined,
    textTransform: span.allCaps ? "uppercase" : undefined,
    letterSpacing: span.smallCaps || span.allCaps ? "0.08em" : undefined,
  };
}

function Nodes({ nodes, prose, indentFirst = true }: { nodes: ResolvedNode[]; prose?: string; indentFirst?: boolean }) {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case "pageBreak":
            // Page-like, not paginated: a rule stands in for the boundary until
            // export, where the break becomes real.
            return <div className="page-break" key={i} aria-label="Page break" />;
          case "spacer":
            return <div className="spacer-lines" key={i} style={{ height: `${node.lines * 1.5}em` }} />;
          case "paragraph":
            return (
              <p className={`tpl-para align-${node.align}`} key={i}>
                {node.spans.map((span, j) => (
                  <span
                    key={j}
                    className={span.placeholder ? "placeholder-var" : undefined}
                    style={spanStyle(span)}
                  >
                    {span.text}
                  </span>
                ))}
              </p>
            );
          case "content":
            return prose ? (
              <Fragment key={i}>
                {prose.split(/\n{2,}/).map((para, j) => (
                  <p className={j === 0 && !indentFirst ? "prose flush" : "prose"} key={j}>
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

export interface DocumentViewProps {
  items: DocumentItem<Block>[];
  registerRef: (blockId: string, el: HTMLDivElement | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * The stitched manuscript. Breaks are derived from each block's depth, so they
 * are rendered here but never editable and never owned by a block.
 */
export function DocumentView({ items, registerRef, selectedId, onSelect }: DocumentViewProps) {
  if (items.length === 0) {
    return (
      <div className="page-sheet">
        <p className="prose empty">
          This manuscript is empty. Add a block in the outline to begin.
        </p>
      </div>
    );
  }

  return (
    <div className="page-sheet">
      {items.map((item, i) =>
        item.kind === "break" ? (
          <div className="doc-break" key={`b${i}`} title={item.templateName} aria-hidden="true">
            <Nodes nodes={item.nodes} />
          </div>
        ) : (
          <div
            className={`doc-block${item.block.id === selectedId ? " selected" : ""}`}
            key={item.block.id}
            ref={(el) => registerRef(item.block.id, el)}
            onClick={() => onSelect(item.block.id)}
            role="presentation"
          >
            <Nodes
              nodes={item.nodes}
              prose={item.block.contentText}
              indentFirst={item.firstLineIndent}
            />
          </div>
        ),
      )}
    </div>
  );
}
