import type { CSSProperties } from "react";
import { previewBody } from "@brigid/shared";
import type { ResolvedSpan, TemplateBody, WorkMeta } from "@brigid/shared";

/**
 * A page at a glance, for laying out something whose whole point is where
 * things sit vertically — a title page especially. Scaled down rather than
 * re-styled, so the proportions are the ones that will print.
 */
/**
 * The sheet is sized in CSS pixels standing in for points — 612 x 792 is US
 * Letter — so one inch is 72 units and a margin is simply 72. Type has to be
 * given in those same units: a browser renders 12pt as 16px, which on this
 * sheet would be a third too large against its own margins.
 */
const MARGIN = 72;

function Spans({ spans }: { spans: ResolvedSpan[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.lineBreak ? (
          <br key={i} />
        ) : (
          <span
            key={i}
            className={span.placeholder ? "placeholder-var" : undefined}
            style={{
              fontWeight: span.bold ? 700 : undefined,
              fontStyle: span.italic ? "italic" : undefined,
              fontVariant: span.smallCaps ? "small-caps" : undefined,
              textTransform: span.allCaps ? "uppercase" : undefined,
              whiteSpace: span.tab ? "pre" : undefined,
            }}
          >
            {span.tab ? "\u0009" : span.text}
          </span>
        ),
      )}
    </>
  );
}

export function PagePreview({
  body,
  work,
  widthPt = 612,
  heightPt = 792,
  marginPt = MARGIN,
  scale = 0.46,
}: {
  body: TemplateBody;
  work: WorkMeta;
  widthPt?: number;
  heightPt?: number;
  marginPt?: number;
  scale?: number;
}) {
  const nodes = previewBody(body.nodes, work);

  const page: CSSProperties = {
    width: widthPt,
    height: heightPt,
    padding: marginPt,
    // Zoom keeps every size in proportion instead of flattening them, which is
    // the only way a vertical layout preview means anything.
    zoom: scale,
  };

  return (
    <div className="page-preview">
      <div className="pp-sheet" style={page}>
        {/* The text block, so the inch of margin is visible rather than implied. */}
        <div className="pp-margin" aria-hidden="true" />
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
                          <td
                            key={ci}
                            style={{
                              textAlign: cell.align ?? "left",
                              verticalAlign: cell.verticalAlign ?? "top",
                              lineHeight: cell.lineHeight,
                              // px, not pt: on this sheet a point is a pixel.
                              fontSize: cell.fontSizePt ? `${cell.fontSizePt}px` : undefined,
                              fontFamily: cell.fontFamily,
                            }}
                          >
                            <Spans spans={cell.spans} />
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
                    // px, not pt: on this sheet a point *is* a pixel.
                    fontSize: node.fontSizePt ? `${node.fontSizePt}px` : undefined,
                    fontFamily: node.fontFamily,
                    margin: 0,
                  }}
                >
                  <Spans spans={node.spans} />
                </p>
              );
          }
        })}
      </div>
      <p className="pp-caption">Page preview</p>
    </div>
  );
}
