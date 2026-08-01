import { FONT_CHOICES } from "@brigid/shared";
import type { TemplateAlign, TemplateMarks } from "@brigid/shared";
import { ChipTools } from "./ChipEditor.js";
import type { ChipEditorHandle } from "./ChipEditor.js";

export interface LineStyle {
  fontFamily?: string | undefined;
  fontSizePt?: number | undefined;
  lineHeight?: number | undefined;
  align?: TemplateAlign | undefined;
}

/**
 * The controls under a line of template content — a paragraph in a break or
 * title page, or a cell in one of its tables. Both are the same kind of thing,
 * so they get the same controls in the same order from the same component
 * rather than two sets that drift.
 *
 * Reading down: what acts on the words and what can be dropped among them,
 * then what they are set in, then how the line as a whole sits.
 */
export function LineControls({
  marks,
  editor,
  style,
  onStyle,
}: {
  marks: TemplateMarks;
  editor: React.RefObject<ChipEditorHandle | null>;
  style: LineStyle;
  onStyle: (patch: LineStyle) => void;
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

      <div className="be-line">
        <select
          className="be-spacing"
          title="Face for this line"
          value={style.fontFamily ?? ""}
          onChange={(e) => onStyle({ fontFamily: e.target.value || undefined })}
        >
          <option value="">Font: inherit</option>
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
          <option value="">Size: inherit</option>
          {[9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36].map((pt) => (
            <option key={pt} value={pt}>
              {pt} pt
            </option>
          ))}
        </select>
      </div>

      <div className="be-line">
        <select
          className="be-spacing"
          title="Line spacing"
          value={String(style.lineHeight ?? "")}
          onChange={(e) =>
            onStyle({ lineHeight: e.target.value ? Number(e.target.value) : undefined })
          }
        >
          <option value="">Spacing: inherit</option>
          <option value="1">Single</option>
          <option value="1.15">1.15</option>
          <option value="1.5">1½</option>
          <option value="2">Double</option>
          <option value="3">Triple</option>
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
      </div>
    </>
  );
}
