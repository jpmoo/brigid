import { useCallback, useEffect, useRef, useState } from "react";
import { Columns3, Rows3 } from "lucide-react";
import { commonMarks } from "@brigid/shared";
import type { TemplateNode } from "@brigid/shared";
import { ChipEditor } from "./ChipEditor.js";

type TableNode = Extract<TemplateNode, { type: "table" }>;

/**
 * A plain table: rules, widths and alignment, with no shading or colour.
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

  const total = node.columns.reduce((sum, c) => sum + (c.width || 0), 0) || 1;

  const setCell = (r: number, c: number, content: TableNode["rows"][number]["cells"][number]["content"]) =>
    onChange({
      ...node,
      rows: node.rows.map((row, ri) =>
        ri === r
          ? { cells: row.cells.map((cell, ci) => (ci === c ? { ...cell, content } : cell)) }
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
            <div className="te-cell" key={`${r}-${c}`}>
              <ChipEditor
                value={cell.content}
                marks={commonMarks(cell.content)}
                onChange={(content) => setCell(r, c, content)}
                placeholder="—"
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

      <div className="te-bar">
        <button className="btn secondary" type="button" onClick={addRow}>
          <Rows3 size={13} /> Row
        </button>
        <button className="btn secondary" type="button" onClick={addColumn}>
          <Columns3 size={13} /> Column
        </button>
        <select
          value=""
          onChange={(e) => {
            const [kind, index] = e.target.value.split(":");
            if (kind === "row") removeRow(Number(index));
            if (kind === "col") removeColumn(Number(index));
            e.target.value = "";
          }}
        >
          <option value="">Remove…</option>
          {node.rows.map((_, r) => (
            <option key={`r${r}`} value={`row:${r}`}>
              Row {r + 1}
            </option>
          ))}
          {node.columns.map((_, c) => (
            <option key={`c${c}`} value={`col:${c}`}>
              Column {c + 1}
            </option>
          ))}
        </select>

        <span className="te-sep" />

        <label className="check">
          <input
            type="checkbox"
            checked={borders.outer}
            onChange={(e) => setBorders({ outer: e.target.checked })}
          />
          <span>Outline</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={borders.rows}
            onChange={(e) => setBorders({ rows: e.target.checked })}
          />
          <span>Rows</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={borders.columns}
            onChange={(e) => setBorders({ columns: e.target.checked })}
          />
          <span>Columns</span>
        </label>
        <label className="be-inline">
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

export const NEW_TABLE = (rows: number, columns: number): TableNode => ({
  type: "table",
  columns: Array.from({ length: columns }, () => ({ width: 1 / columns })),
  rows: Array.from({ length: rows }, () => ({
    cells: Array.from({ length: columns }, () => ({ content: [] })),
  })),
  borders: { outer: false, rows: false, columns: false, widthPt: 1 },
});
