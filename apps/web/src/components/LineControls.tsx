import { FONT_CHOICES } from "@brigid/shared";
import type { TemplateAlign, TemplateMarks } from "@brigid/shared";
import { ChipTools } from "./ChipEditor.js";
import type { ChipEditorHandle } from "./ChipEditor.js";

/**
 * CSS line-height multiplies the font size; a word processor's "double" is
 * twice the font's own natural line, which for Courier and Times is about
 * 1.125 of the font size. So "Double" is 2.25 — 2 is visibly tight.
 */
const SPACINGS = [1.125, 1.4, 1.6875, 2.25, 3.375];

/** Values set before this scale existed still land on the right option. */
function nearestSpacing(value: number | undefined): string {
  if (value === undefined) return "";
  const match = SPACINGS.reduce((best, n) =>
    Math.abs(n - value) < Math.abs(best - value) ? n : best,
  );
  return Math.abs(match - value) < 0.2 ? String(match) : "";
}

export interface LineStyle {
  fontFamily?: string | undefined;
  fontSizePt?: number | undefined;
  lineHeight?: number | undefined;
  align?: TemplateAlign | undefined;
  /** Cells only: a paragraph has no row to sit within. */
  verticalAlign?: "top" | "middle" | "bottom" | undefined;
}

/**
 * The controls under a line of template content — a paragraph in a break or
 * title page, or a cell in one of its tables. Both are the same kind of thing,
 * so they get the same controls in the same order from the same component
 * rather than two sets that drift.
 *
 * Reading down: what acts on the words and what can be dropped among them,
 * then everything about the line's setting on one row — face, size, spacing,
 * placement. Split across two rows these read as unrelated pairs, and in a
 * narrow table column the second row was what got pushed out of sight.
 */
export function LineControls({
  marks,
  editor,
  style,
  onStyle,
  vertical = false,
}: {
  marks: TemplateMarks;
  editor: React.RefObject<ChipEditorHandle | null>;
  style: LineStyle;
  onStyle: (patch: LineStyle) => void;
  /** Offer vertical placement — only a table cell has a row to sit within. */
  vertical?: boolean;
}) {
  return (
    <>
      <div className="be-line">
        {(["bold", "italic", "smallCaps", "allCaps"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`be-mark${marks[key] ? " on" : ""}`}
            aria-pressed={Boolean(marks[key])}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.current?.toggleMark(key)}
            title={key}
          >
            {key === "bold" ? "B" : key === "italic" ? "I" : key === "smallCaps" ? "Sc" : "AA"}
          </button>
        ))}
        <span className="be-gap" />
        <ChipTools editor={editor} />
      </div>

      <div className="be-line be-line-setting">
        <select
          className="be-spacing"
          title="Face for this line"
          value={style.fontFamily ?? ""}
          onChange={(e) => onStyle({ fontFamily: e.target.value || undefined })}
        >
          <option value="">Font</option>
          {FONT_CHOICES.map((f) => (
            <option key={f.label} value={f.stack}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="be-spacing"
          title="Size for this line"
          value={String(style.fontSizePt ?? "")}
          onChange={(e) =>
            onStyle({ fontSizePt: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">Size</option>
          {[9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map((pt) => (
            <option key={pt} value={pt}>
              {pt} pt
            </option>
          ))}
        </select>
        <select
          className="be-spacing"
          title="Line spacing"
          value={nearestSpacing(style.lineHeight)}
          onChange={(e) =>
            onStyle({ lineHeight: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">Spacing</option>
          <option value="1.125">Single</option>
          <option value="1.4">1.25</option>
          <option value="1.6875">1½</option>
          <option value="2.25">Double</option>
          <option value="3.375">Triple</option>
        </select>
        <select
          className="be-spacing"
          title="Justification"
          value={style.align ?? "left"}
          onChange={(e) => onStyle({ align: e.target.value as TemplateAlign })}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
        {vertical ? (
          <select
            className="be-spacing"
            title="Vertical placement in the row"
            value={style.verticalAlign ?? "top"}
            onChange={(e) =>
              onStyle({ verticalAlign: e.target.value as "top" | "middle" | "bottom" })
            }
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        ) : null}
      </div>
    </>
  );
}
