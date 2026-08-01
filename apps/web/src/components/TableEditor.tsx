import { useCallback, useEffect, useRef, useState } from "react";
import { Columns3, Rows3 } from "lucide-react";
import { commonMarks } from "@brigid/shared";
import type { TemplateMarks, TemplateNode } from "@brigid/shared";
import { ChipEditor } from "./ChipEditor.js";
import { LineControls } from "./LineControls.js";
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
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const [dragging, setDragging] = useState<number | null>(null);
  // Controls live in a full-width row beneath the table rather than inside the
  // cell: a narrow column swallows them entirely.
  const [focused, setFocused] = useState<{ r: number; c: number } | null>(null);
  const [cellMarks, setCellMarks] = useState<TemplateMarks>({});
  const cellRefs = useRef(new Map<string, ChipEditorHandle>());
  const focusedHandle = focused ? cellRefs.current.get(`${focused.r}-${focused.c}`) : undefined;

  const total = node.columns.reduce((sum, c) => sum + (c.width || 0), 0) || 1;

  type Cell = TableNode["rows"][number]["cells"][number];

  /**
   * Cells hold their identity across edits, so React only re-renders the one
   * that changed — but the patch itself must come off the node as it is *now*.
   * Closing over the render's node meant two edits landing before a re-render
   * would silently drop the earlier one, taking a column's content with it.
   */
  const patchCell = (r: number, c: number, patch: Partial<Cell>) =>
    onChange({
      ...nodeRef.current,
      rows: nodeRef.current.rows.map((row, ri) =>
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
                onActiveMarks={setCellMarks}
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
        {focusedCell && focused ? (
          <>
            <span className="te-bar-label">
              Row {focused.r + 1}, column {focused.c + 1}
            </span>
            {/* The same controls a paragraph gets: a cell is a line of template
                content like any other. */}
            <div className="te-cell-lines">
              <LineControls
                marks={cellMarks}
                editor={{ current: focusedHandle ?? null }}
                style={{
                  fontFamily: focusedCell.fontFamily,
                  fontSizePt: focusedCell.fontSizePt,
                  lineHeight: focusedCell.lineHeight,
                  align: focusedCell.align ?? node.columns[focused.c]?.align,
                }}
                onStyle={(patch) => patchCell(focused.r, focused.c, patch)}
              />
            </div>
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

      <div className="te-bar borders">
        <span className="te-bar-label">Borders</span>
        <label className="check">
          <input
            type="checkbox"
            checked={borders.outer}
            onChange={(e) => setBorders({ outer: e.target.checked })}
          />
          <span>Table</span>
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
        <select
          title="Border weight"
          value={String(borders.widthPt ?? 1)}
          onChange={(e) => setBorders({ widthPt: Number(e.target.value) })}
        >
          {[0.5, 0.75, 1, 1.5, 2, 3].map((pt) => (
            <option key={pt} value={pt}>
              {pt} pt
            </option>
          ))}
        </select>
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
