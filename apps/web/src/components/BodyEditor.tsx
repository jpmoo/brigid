import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { commonMarks } from "@brigid/shared";
import type { TemplateBody, TemplateMarks, TemplateNode } from "@brigid/shared";
import { useRef, useState } from "react";
import { ChipEditor } from "./ChipEditor.js";
import type { ChipEditorHandle } from "./ChipEditor.js";
import { useDialogs } from "./Dialogs.js";
import { LineControls } from "./LineControls.js";
import { NEW_TABLE, TableEditor } from "./TableEditor.js";

/**
 * Edits a template body — the shared shape behind break templates, block
 * formats, and running heads. Text lines are typed directly, with variables
 * dropped in as chips and tabs as visible stops.
 */
export function BodyEditor({
  body,
  onChange,
}: {
  body: TemplateBody;
  onChange: (next: TemplateBody) => void;
}) {
  const dialogs = useDialogs();
  const nodes = body.nodes;
  const set = (next: TemplateNode[]) => onChange({ nodes: next });
  const replace = (i: number, node: TemplateNode) =>
    set(nodes.map((n, j) => (j === i ? node : n)));

  const move = (i: number, delta: number) => {
    const target = i + delta;
    if (target < 0 || target >= nodes.length) return;
    const next = [...nodes];
    const [item] = next.splice(i, 1);
    if (item) next.splice(target, 0, item);
    set(next);
  };

  return (
    <div className="body-editor">
      {nodes.map((node, i) => (
        <div className="be-row" key={i}>
          <div className="be-kind">
            {node.type === "paragraph"
              ? "Text"
              : node.type === "spacer"
                ? "Blank"
                : node.type === "pageBreak"
                  ? "Page break"
                  : node.type === "table"
                    ? "Table"
                    : "Content"}
          </div>

          <div className="be-main">
            {node.type === "paragraph" ? (
              <ParagraphRow node={node} onChange={(n) => replace(i, n)} />
            ) : node.type === "spacer" ? (
              <label className="be-inline">
                <input
                  type="number"
                  min={0.25}
                  max={40}
                  step={0.25}
                  value={node.lines}
                  onChange={(e) =>
                    replace(i, { type: "spacer", lines: Number(e.target.value) || 1 })
                  }
                />
                <span className="muted">blank lines</span>
              </label>
            ) : node.type === "pageBreak" ? (
              <span className="muted">Starts a new page.</span>
            ) : node.type === "table" ? (
              <TableEditor node={node} onChange={(n) => replace(i, n)} />
            ) : (
              <span className="muted">The block&rsquo;s own prose goes here.</span>
            )}
          </div>

          <div className="be-actions">
            <button className="btn ghost" type="button" title="Move up" onClick={() => move(i, -1)}>
              <ArrowUp size={13} />
            </button>
            <button className="btn ghost" type="button" title="Move down" onClick={() => move(i, 1)}>
              <ArrowDown size={13} />
            </button>
            <button
              className="btn ghost"
              type="button"
              title="Remove"
              onClick={() => set(nodes.filter((_, j) => j !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}

      <div className="be-add">
        <span className="muted">Add:</span>
        <button
          className="btn secondary"
          type="button"
          onClick={() => set([...nodes, { type: "paragraph", align: "center", content: [] }])}
        >
          <Plus size={13} /> Text
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => set([...nodes, { type: "spacer", lines: 1 }])}
        >
          <Plus size={13} /> Blank line
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => set([...nodes, { type: "pageBreak" }])}
        >
          <Plus size={13} /> Page break
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => {
            void (async () => {
              const answer = await dialogs.prompt({
                title: "New table",
                fields: [
                  { label: "Rows", value: "3", type: "number", min: 1, max: 40 },
                  { label: "Columns", value: "2", type: "number", min: 1, max: 12 },
                ],
                confirmLabel: "Add table",
              });
              if (!answer) return;
              const rows = Number(answer[0]);
              const cols = Number(answer[1]);
              if (!rows || !cols || rows < 1 || cols < 1) return;
              set([...nodes, NEW_TABLE(Math.min(rows, 40), Math.min(cols, 12))]);
            })();
          }}
        >
          <Plus size={13} /> Table
        </button>
      </div>
    </div>
  );
}

function ParagraphRow({
  node,
  onChange,
}: {
  node: Extract<TemplateNode, { type: "paragraph" }>;
  onChange: (next: TemplateNode) => void;
}) {
  const editor = useRef<ChipEditorHandle>(null);
  // What the toolbar shows is where the caret is, not what the whole line is.
  const [marks, setMarks] = useState<TemplateMarks>(() => commonMarks(node.content));

  return (
    <div className="be-para">
      <ChipEditor
        ref={editor}
        value={node.content}
        marks={marks}
        onChange={(content) => onChange({ ...node, content })}
        onActiveMarks={setMarks}
        showToolbar={false}
      />
      <LineControls
        marks={marks}
        editor={editor}
        style={{
          fontFamily: node.fontFamily,
          fontSizePt: node.fontSizePt,
          lineHeight: node.lineHeight,
          align: node.align,
        }}
        onStyle={(patch) => onChange({ ...node, ...patch })}
      />
    </div>
  );
}
