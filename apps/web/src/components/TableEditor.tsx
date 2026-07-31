import { useCallback, useEffect, useRef, useState } from "react";
import { Columns3, Rows3 } from "lucide-react";
import { VARIABLES, VARIABLE_NAMES, commonMarks } from "@brigid/shared";
import type { TemplateAlign, TemplateInline, TemplateNode, VariableName } from "@brigid/shared";
import { ChipEditor } from "./ChipEditor.js";
import type { ChipEditorHandle } from "./ChipEditor.js";

type TableNode = Extract<TemplateNode, { type: "table" }>;

/**
 * A plain table: rules, widths and alignment, with no shading or color.
 *
 * Column widths are dragged on the boundary between two columns and only ever
 * move width from one to its neighbour, so the row always sums to the full
 * width and the table can't drift out of shape.
 */
export function TableEditor({
  node,
  onChange,
}: {
  node: TableNode;
  onChange: (next: TemplateNode) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Controls live in a full-width row beneath the table rather than inside the
  // cell: a narrow column swallows them entirely.
  const [focused, setFocused] = useState<{ r: number; c: number } | null>(null);
  const cellRefs = useRef(new Map<string, ChipEditorHandle>());
  const focusedHandle = focused ? cellRefs.current.get(`${focused.r}-${focused.c}`) : undefined;

  const total = node.columns.reduce((sum, c) => sum + (c.width || 0), 0) || 1;

  type Cell = TableNode["rows"][number]["cells"][number];

  const patchCell = (r: number, c: number, patch: Partial<Cell>) =>
    onChange({
      ...node,
      rows: node.rows.map((row, ri) =>
        ri === r
          ? { cells: row.cells.map((cell, ci) => (ci === c ? { ...cell, ...patch } : cell)) }
          : row,
      ),
    });

  const addRow = () =>
    onChange({
      ...node,
      rows: [...node.rows, { cells: node.columns.map(() => ({ content: [] })) }],
    });

  const addColumn = () => {
    // Take the new column's share proportionally, so existing columns keep
    // their relative widths.
    const share = 1 / (node.columns.length + 1);
    const scale = 1 - share;
    onChange({
      ...node,
      columns: [...node.columns.map((c) => ({ ...c, width: c.width * scale })), { width: share }],
      rows: node.rows.map((row) => ({ cells: [...row.cells, { content: [] }] })),
    });
  };

  const removeRow = (r: number) =>
    onChange({ ...node, rows: node.rows.filter((_, ri) => ri !== r) });

  const removeColumn = (c: number) => {
    if (node.columns.length <= 1) return;
    const freed = node.columns[c]?.width ?? 0;
    const remaining = node.columns.filter((_, ci) => ci !== c);
    const rest = remaining.reduce((sum, col) => sum + col.width, 0) || 1;
    onChange({
      ...node,
      columns: remaining.map((col) => ({ ...col, width: col.width + (col.width / rest) * freed })),
      rows: node.rows.map((row) => ({ cells: row.cells.filter((_, ci) => ci !== c) })),
    });
  };

  /** Drag a boundary: width moves between column i and i+1 only. */
  const onDrag = useCallback(
    (event: PointerEvent) => {
      const grid = gridRef.current;
      if (grid === null || dragging === null) return;
      const rect = grid.getBoundingClientRect();
      if (rect.width === 0) return;

      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * total;
      const before = node.columns.slice(0, dragging).reduce((sum, c) => sum + c.width, 0);
      const pair = (node.columns[dragging]?.width ?? 0) + (node.columns[dragging + 1]?.width ?? 0);

      // Keep both sides usable rather than letting one collapse to nothing.
      const min = total * 0.05;
      const left = Math.min(Math.max(fraction - before, min), pair - min);

      onChange({
        ...node,
        columns: node.columns.map((col, i) =>
          i === dragging ? { ...col, width: left } : i === dragging + 1 ? { ...col, width: pair - left } : col,
        ),
      });
    },
    [dragging, node, onChange, total],
  );

  useEffect(() => {
    if (dragging === null) return;
    const stop = () => setDragging(null);
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", onDrag);
      window.removeEventListener("pointerup", stop);
    };
  }, [dragging, onDrag]);

  const focusedCell = focused ? node.rows[focused.r]?.cells[focused.c] ?? null : null;
  const borders = node.borders;
  const setBorders = (patch: Partial<TableNode["borders"]>) =>
    onChange({ ...node, borders: { ...borders, ...patch } });

  return (
    <div className="table-editor">
      <div
        className="te-grid"
        ref={gridRef}
        style={{ gridTemplateColumns: node.columns.map((c) => `${(c.width / total) * 100}%`).join(" ") }}
      >
        {node.rows.map((row, r) =>
          row.cells.map((cell, c) => (
            <div
              className={`te-cell${focused?.r === r && focused?.c === c ? " focused" : ""}`}
              key={`${r}-${c}`}
              onFocusCapture={() => setFocused({ r, c })}
            >
              <ChipEditor
                ref={(handle) => {
                  const key = `${r}-${c}`;
                  if (handle) cellRefs.current.set(key, handle);
                  else cellRefs.current.delete(key);
                }}
                value={cell.content}
                marks={commonMarks(cell.content)}
                onChange={(content) => patchCell(r, c, { content })}
                placeholder=""
                multiline
                showToolbar={false}
              />
            </div>
          )),
        )}

        {/* Boundaries sit between columns, positioned by cumulative width. */}
        {node.columns.slice(0, -1).map((_, i) => {
          const left =
            (node.columns.slice(0, i + 1).reduce((sum, col) => sum + col.width, 0) / total) * 100;
          return (
            <div
              key={`h${i}`}
              className={`te-handle${dragging === i ? " active" : ""}`}
              style={{ left: `${left}%` }}
              onPointerDown={(e) => {
                e.preventDefault();
                setDragging(i);
              }}
              title="Drag to resize"
              role="separator"
              aria-orientation="vertical"
            />
          );
        })}
      </div>

      <div className="te-cellbar">
        {focusedCell ? (
          <>
            <span className="te-bar-label">
              Row {focused!.r + 1}, column {focused!.c + 1}
            </span>
            <CellControls
              content={focusedCell.content}
              align={focusedCell.align ?? node.columns[focused!.c]?.align ?? "left"}
              onAlign={(align) => patchCell(focused!.r, focused!.c, { align })}
              onContent={(content) => patchCell(focused!.r, focused!.c, { content })}
            />
            <select
              value=""
              // Inserting has to reach into the cell's own editor, since that is
              // where the caret is.
              onMouseDown={(e) => e.preventDefault()}
              onChange={(e) => {
                const name = e.target.value as VariableName;
                if (name) focusedHandle?.insertVariable(name);
                e.target.value = "";
              }}
            >
              <option value="">Insert chip…</option>
              {VARIABLE_NAMES.filter((n) => VARIABLES[n].insertAs === "inline").map((n) => (
                <option key={n} value={n}>
                  {VARIABLES[n].label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn secondary chip-tab-btn"
              title="Advance to the next tab stop — spacing set by the format's tab stop"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => focusedHandle?.insertTab()}
            >
              ⇥ Tab
            </button>
          </>
        ) : (
          <span className="te-bar-hint">
            Click a cell to format it. Enter starts a new line inside a cell.
          </span>
        )}
      </div>

      <div className="te-bar">
        <span className="te-bar-label">Table</span>
        <button className="btn secondary" type="button" onClick={addRow}>
          <Rows3 size={13} /> Add row
        </button>
        <button className="btn secondary" type="button" onClick={addColumn}>
          <Columns3 size={13} /> Add column
        </button>
        <select
          value=""
          onChange={(e) => {
            const [kind, index] = e.target.value.split(":");
            if (kind === "row") removeRow(Number(index));
            if (kind === "col") removeColumn(Number(index));
            setFocused(null);
            e.target.value = "";
          }}
        >
          <option value="">Delete a row or column…</option>
          {node.rows.map((_, r) => (
            <option key={`r${r}`} value={`row:${r}`}>
              Delete row {r + 1}
            </option>
          ))}
          {node.columns.map((_, c) => (
            <option key={`c${c}`} value={`col:${c}`}>
              Delete column {c + 1}
            </option>
          ))}
        </select>
      </div>

      <div className="te-bar">
        <span className="te-bar-label">Rules</span>
        <label className="check">
          <input
            type="checkbox"
            checked={borders.outer}
            onChange={(e) => setBorders({ outer: e.target.checked })}
          />
          <span>Around the table</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={borders.rows}
            onChange={(e) => setBorders({ rows: e.target.checked })}
          />
          <span>Between rows</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={borders.columns}
            onChange={(e) => setBorders({ columns: e.target.checked })}
          />
          <span>Between columns</span>
        </label>
        <label className="be-inline">
          <span className="muted">Weight</span>
          <input
            type="number"
            min={0.25}
            max={6}
            step={0.25}
            value={borders.widthPt ?? 1}
            onChange={(e) => setBorders({ widthPt: Number(e.target.value) || 1 })}
          />
          <span className="muted">pt</span>
        </label>
      </div>
    </div>
  );
}

/**
 * The same alignment and mark controls a paragraph gets, per cell — a cell is a
 * line of template content like any other, and a title page's contact block
 * needs its columns aligned independently.
 */
function CellControls({
  content,
  align,
  onAlign,
  onContent,
}: {
  content: TemplateInline[];
  align: TemplateAlign;
  onAlign: (align: TemplateAlign) => void;
  onContent: (content: TemplateInline[]) => void;
}) {
  const marks = commonMarks(content);
  const toggle = (key: "bold" | "italic" | "smallCaps" | "allCaps") => {
    const next = { ...marks, [key]: !marks[key] };
    onContent(content.map((i) => (i.type === "tab" ? i : { ...i, ...next })));
  };

  return (
    <div className="te-cell-controls">
      <select value={align} onChange={(e) => onAlign(e.target.value as TemplateAlign)} title="Alignment">
        <option value="left">Left</option>
        <option value="center">Center</option>
        <option value="right">Right</option>
      </select>
      {(["bold", "italic", "smallCaps", "allCaps"] as const).map((key) => (
        <button
          key={key}
          type="button"
          className={`be-mark${marks[key] ? " on" : ""}`}
          aria-pressed={Boolean(marks[key])}
          onClick={() => toggle(key)}
          title={key}
        >
          {key === "bold" ? "B" : key === "italic" ? "I" : key === "smallCaps" ? "Sc" : "AA"}
        </button>
      ))}
    </div>
  );
}

export const NEW_TABLE = (rows: number, columns: number): TableNode => ({
  type: "table",
  columns: Array.from({ length: columns }, () => ({ width: 1 / columns })),
  rows: Array.from({ length: rows }, () => ({
    cells: Array.from({ length: columns }, () => ({ content: [] })),
  })),
  borders: { outer: false, rows: false, columns: false, widthPt: 1 },
});
