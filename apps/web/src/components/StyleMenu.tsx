import { FONT_CHOICES } from "@brigid/shared";
import type { Typography } from "@brigid/shared";

/**
 * A text style — the shape of a format like Regular text, which has no layout
 * to speak of, only type. Presented as a menu over a live sample rather than a
 * body editor, because there is nothing to arrange: the block's own prose is
 * the content.
 */
export function StyleMenu({
  value,
  onChange,
}: {
  value: Typography;
  onChange: (next: Typography) => void;
}) {
  const set = (patch: Partial<Typography>) => onChange({ ...value, ...patch });

  const sampleStyle = {
    fontFamily: value.fontFamily || FONT_CHOICES[1]?.stack,
    fontSize: `${value.fontSizePt ?? 12}pt`,
    fontWeight: value.fontWeight ?? 400,
    fontStyle: value.italic ? "italic" : "normal",
    lineHeight: value.lineHeight ?? 1.5,
    textAlign: value.align ?? "left",
    tabSize: `${value.tabStopIn ?? 0.5}in`,
  } as const;

  const indent = `${value.firstLineIndentIn ?? 0}in`;

  return (
    <>
      <div className="style-sample" style={sampleStyle}>
        <p style={{ margin: 0, textIndent: 0 }}>
          The tide had gone out further than Maren had ever seen it, leaving the harbour a bowl of
          grey mud studded with the ribs of boats nobody remembered.
        </p>
        <p style={{ margin: 0, textIndent: indent }}>
          Her father would have called it a judgement. Her father called most weather a judgement.
        </p>
      </div>

      <div className="row">
        <div className="field">
          <label className="field-label">Font</label>
          <select
            value={value.fontFamily ?? ""}
            onChange={(e) => set({ fontFamily: e.target.value || undefined })}
          >
            <option value="">Inherit</option>
            {FONT_CHOICES.map((f) => (
              <option key={f.label} value={f.stack}>
                {f.label}
              </option>
            ))}
          </select>
          <p className="field-hint">
            Only fonts that resolve on a stock machine — no webfonts to go missing.
          </p>
        </div>
        <div className="field" style={{ maxWidth: 92 }}>
          <label className="field-label">Size (pt)</label>
          <input
            type="number"
            min={6}
            max={72}
            value={value.fontSizePt ?? 12}
            onChange={(e) => set({ fontSizePt: Number(e.target.value) || undefined })}
          />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label className="field-label">Weight</label>
          <select
            value={String(value.fontWeight ?? 400)}
            onChange={(e) => set({ fontWeight: Number(e.target.value) })}
          >
            <option value="300">Light</option>
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="600">Semibold</option>
            <option value="700">Bold</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Style</label>
          <select
            value={value.italic ? "italic" : "normal"}
            onChange={(e) => set({ italic: e.target.value === "italic" })}
          >
            <option value="normal">Roman</option>
            <option value="italic">Italic</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Justification</label>
          <select
            value={value.align ?? "left"}
            onChange={(e) => set({ align: e.target.value as Typography["align"] })}
          >
            <option value="left">Left (ragged right)</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="justify">Justified</option>
          </select>
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label className="field-label">Line spacing</label>
          <select
            value={String(value.lineHeight ?? 1.6875)}
            onChange={(e) => set({ lineHeight: Number(e.target.value) })}
          >
            <option value="1.125">Single</option>
            <option value="1.4">1.25</option>
            <option value="1.6875">1½</option>
            <option value="2.25">Double</option>
            <option value="3.375">Triple</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">First-line indent (in)</label>
          <input
            type="number"
            min={0}
            max={3}
            step={0.05}
            value={value.firstLineIndentIn ?? 0}
            onChange={(e) => set({ firstLineIndentIn: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label className="field-label">Tab stop (in)</label>
          <input
            type="number"
            min={0.1}
            max={4}
            step={0.05}
            value={value.tabStopIn ?? 0.5}
            onChange={(e) => set({ tabStopIn: Number(e.target.value) })}
          />
        </div>
      </div>
    </>
  );
}
