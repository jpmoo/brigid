import type { CSSProperties } from "react";
import { previewBody } from "@brigid/shared";
import type { TemplateBody, WorkMeta } from "@brigid/shared";

/**
 * A page at a glance, for laying out something whose whole point is where
 * things sit vertically — a title page especially. Scaled down rather than
 * re-styled, so the proportions are the ones that will print.
 */
export function PagePreview({
  body,
  work,
  widthPt = 612,
  heightPt = 792,
  scale = 0.34,
}: {
  body: TemplateBody;
  work: WorkMeta;
  widthPt?: number;
  heightPt?: number;
  scale?: number;
}) {
  const nodes = previewBody(body.nodes, work);

  const page: CSSProperties = {
    width: widthPt,
    height: heightPt,
    // Zoom keeps every size in proportion instead of flattening them, which is
    // the only way a vertical layout preview means anything.
    zoom: scale,
  };

  return (
    <div className="page-preview">
      <div className="pp-sheet" style={page}>
        {nodes.map((node, i) => {
          switch (node.type) {
            case "pageBreak":
              return <div className="pp-break" key={i} />;
            case "spacer":
              return <div key={i} style={{ height: `${node.lines * 1.5}em` }} />;
            case "content":
              return (
                <p className="pp-content" key={i}>
                  the block&rsquo;s prose
                </p>
              );
            case "table":
              return (
                <table className="pp-table" key={i}>
                  <tbody>
                    {node.rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.cells.map((cell, ci) => (
                          <td key={ci} style={{ textAlign: cell.align ?? "left" }}>
                            {cell.spans.map((s) => s.text).join("")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            case "paragraph":
              return (
                <p
                  key={i}
                  style={{
                    textAlign: node.align,
                    lineHeight: node.lineHeight,
                    fontSize: node.fontSizePt ? `${node.fontSizePt}pt` : undefined,
                    margin: 0,
                  }}
                >
                  {node.spans.map((span, j) => (
                    <span
                      key={j}
                      className={span.placeholder ? "placeholder-var" : undefined}
                      style={{
                        fontWeight: span.bold ? 700 : undefined,
                        fontStyle: span.italic ? "italic" : undefined,
                        fontVariant: span.smallCaps ? "small-caps" : undefined,
                        textTransform: span.allCaps ? "uppercase" : undefined,
                      }}
                    >
                      {span.text}
                    </span>
                  ))}
                </p>
              );
          }
        })}
      </div>
      <p className="pp-caption">Page preview</p>
    </div>
  );
}
