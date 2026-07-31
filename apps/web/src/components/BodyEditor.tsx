import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { VARIABLES, VARIABLE_NAMES, commonMarks, parseInlines, serializeInlines } from "@brigid/shared";
import type { TemplateBody, TemplateNode, VariableName } from "@brigid/shared";

/**
 * Edits a template body — the shared shape behind break templates, block
 * formats, and running heads. Paragraph text is plain, with `{{variable}}`
 * tokens for anything resolved at render, so a chapter break can be typed
 * rather than assembled node by node.
 */
export function BodyEditor({
  body,
  onChange,
}: {
  body: TemplateBody;
  onChange: (next: TemplateBody) => void;
}) {
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
          <div className="be-kind">{node.type === "paragraph" ? "Text" : node.type === "spacer" ? "Blank" : node.type === "pageBreak" ? "Page break" : "Content"}</div>

          <div className="be-main">
            {node.type === "paragraph" ? (
              <ParagraphRow node={node} onChange={(n) => replace(i, n)} />
            ) : node.type === "spacer" ? (
              <label className="be-inline">
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={node.lines}
                  onChange={(e) => replace(i, { type: "spacer", lines: Number(e.target.value) || 1 })}
                />
                <span className="muted">blank lines</span>
              </label>
            ) : node.type === "pageBreak" ? (
              <span className="muted">Starts a new page.</span>
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
  const text = serializeInlines(node.content);
  const marks = commonMarks(node.content);

  const rewrite = (nextText: string, nextMarks = marks) =>
    onChange({ ...node, content: parseInlines(nextText, nextMarks) });

  const insert = (name: VariableName) => rewrite(`${text}{{${name}}}`);

  const toggle = (key: "bold" | "italic" | "smallCaps" | "allCaps") =>
    rewrite(text, { ...marks, [key]: !marks[key] });

  return (
    <div className="be-para">
      <input
        type="text"
        value={text}
        placeholder="Chapter {{levelCounter}}"
        onChange={(e) => rewrite(e.target.value)}
      />
      <div className="be-controls">
        <select
          value={node.align ?? "left"}
          onChange={(e) => onChange({ ...node, align: e.target.value as typeof node.align })}
          title="Alignment"
        >
          <option value="left">Left</option>
          <option value="center">Centre</option>
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

        <select
          value=""
          onChange={(e) => e.target.value && insert(e.target.value as VariableName)}
          title="Insert a variable"
        >
          <option value="">Insert variable…</option>
          {VARIABLE_NAMES.filter((n) => VARIABLES[n].insertAs === "inline").map((n) => (
            <option key={n} value={n}>
              {VARIABLES[n].label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
