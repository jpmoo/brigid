import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BlockFormatSettings, BreakTemplateSettings, TemplateBody } from "@brigid/shared";
import { ApiError, api } from "../../api.js";
import type { Template } from "../../api.js";
import { BodyEditor } from "../../components/BodyEditor.js";

const EMPTY_BREAK: BreakTemplateSettings = { suppressOnFirstChild: false, indentFirstParagraph: false };
const EMPTY_FORMAT: BlockFormatSettings = {
  countsTowardWordCount: true,
  structural: true,
  rendersInDocument: true,
};

export function TemplatesPane({ templates, onReload }: { templates: Template[]; onReload: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const breaks = templates.filter((t) => t.category === "break");
  const formats = templates.filter((t) => t.category === "block-format");

  async function create(category: "break" | "block-format") {
    const name = prompt(category === "break" ? "Name for the new break" : "Name for the new format");
    if (!name) return;
    const { template } = await api.createTemplate({
      category,
      name,
      body: category === "break" ? { nodes: [{ type: "spacer", lines: 1 }] } : { nodes: [{ type: "content" }] },
      ...(category === "break" ? { breakSettings: EMPTY_BREAK } : { formatSettings: EMPTY_FORMAT }),
    });
    onReload();
    setSelectedId(template.id);
  }

  return (
    <div className="tpl-layout">
      <div className="tpl-list">
        <div className="tpl-group">
          <div className="tpl-group-head">
            <span>Breaks</span>
            <button className="btn ghost" type="button" title="New break" onClick={() => void create("break")}>
              <Plus size={14} />
            </button>
          </div>
          {breaks.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tpl-item${t.id === selectedId ? " selected" : ""}`}
              onClick={() => setSelectedId(t.id)}
            >
              {t.name}
              {t.builtinKey ? <em>built-in</em> : null}
            </button>
          ))}
        </div>

        <div className="tpl-group">
          <div className="tpl-group-head">
            <span>Block formats</span>
            <button
              className="btn ghost"
              type="button"
              title="New format"
              onClick={() => void create("block-format")}
            >
              <Plus size={14} />
            </button>
          </div>
          {formats.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tpl-item${t.id === selectedId ? " selected" : ""}`}
              onClick={() => setSelectedId(t.id)}
            >
              {t.name}
              {t.builtinKey ? <em>built-in</em> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="tpl-detail">
        {selected ? (
          <TemplateEditor
            key={selected.id}
            template={selected}
            onSaved={onReload}
            onDeleted={() => {
              setSelectedId(null);
              onReload();
            }}
          />
        ) : (
          <p className="muted">Pick a template on the left.</p>
        )}
      </div>
    </div>
  );
}

function TemplateEditor({
  template,
  onSaved,
  onDeleted,
}: {
  template: Template;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState<TemplateBody>(template.body);
  const [brk, setBrk] = useState<BreakTemplateSettings>(template.breakSettings ?? EMPTY_BREAK);
  const [fmt, setFmt] = useState<BlockFormatSettings>(template.formatSettings ?? EMPTY_FORMAT);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const isBreak = template.category === "break";
  const typo = (isBreak ? brk.typography : fmt.typography) ?? {};
  const setTypo = (patch: Partial<NonNullable<BreakTemplateSettings["typography"]>>) => {
    const next = { ...typo, ...patch };
    if (isBreak) setBrk({ ...brk, typography: next });
    else setFmt({ ...fmt, typography: next });
  };

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await api.updateTemplate(template.id, {
        name,
        body,
        ...(isBreak ? { breakSettings: brk } : { formatSettings: fmt }),
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${template.name}"? This can't be undone.`)) return;
    try {
      await api.deleteTemplate(template.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not delete");
    }
  }

  return (
    <>
      {error ? <div className="alert error">{error}</div> : null}
      {saved ? <div className="alert ok">Saved.</div> : null}

      <div className="field">
        <label className="field-label" htmlFor="tplName">
          Name
        </label>
        <input
          id="tplName"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
      </div>

      <h4 className="tpl-section">Body</h4>
      <BodyEditor
        body={body}
        onChange={(b) => {
          setBody(b);
          setSaved(false);
        }}
      />

      <h4 className="tpl-section">Behaviour</h4>
      {isBreak ? (
        <div className="stack">
          <label className="check">
            <input
              type="checkbox"
              checked={brk.suppressOnFirstChild}
              onChange={(e) => setBrk({ ...brk, suppressOnFirstChild: e.target.checked })}
            />
            <span>
              Skip on the first child <em>— an ornament under a heading is wrong</em>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={brk.indentFirstParagraph ?? false}
              onChange={(e) => setBrk({ ...brk, indentFirstParagraph: e.target.checked })}
            />
            <span>
              Indent the paragraph it opens <em>— usually flush</em>
            </span>
          </label>
        </div>
      ) : (
        <div className="stack">
          <label className="check">
            <input
              type="checkbox"
              checked={fmt.countsTowardWordCount}
              onChange={(e) => setFmt({ ...fmt, countsTowardWordCount: e.target.checked })}
            />
            <span>Counts toward the manuscript word count</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={fmt.structural}
              onChange={(e) => setFmt({ ...fmt, structural: e.target.checked })}
            />
            <span>
              Takes part in levels and breaks <em>— front matter opts out</em>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={fmt.rendersInDocument}
              onChange={(e) => setFmt({ ...fmt, rendersInDocument: e.target.checked })}
            />
            <span>
              Appears in the document <em>— notes don&rsquo;t</em>
            </span>
          </label>
        </div>
      )}

      <h4 className="tpl-section">Manuscript typography</h4>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        Used in Manuscript mode only. Book mode keeps its own type.
      </p>
      <div className="row">
        <div className="field">
          <label className="field-label">Font</label>
          <input
            type="text"
            value={typo.fontFamily ?? ""}
            placeholder='"Courier New", monospace'
            onChange={(e) => setTypo({ fontFamily: e.target.value || undefined })}
          />
        </div>
        <div className="field" style={{ maxWidth: 90 }}>
          <label className="field-label">Size (pt)</label>
          <input
            type="number"
            min={4}
            max={96}
            value={typo.fontSizePt ?? ""}
            onChange={(e) => setTypo({ fontSizePt: Number(e.target.value) || undefined })}
          />
        </div>
        <div className="field" style={{ maxWidth: 90 }}>
          <label className="field-label">Line height</label>
          <input
            type="number"
            min={0.8}
            max={4}
            step={0.1}
            value={typo.lineHeight ?? ""}
            onChange={(e) => setTypo({ lineHeight: Number(e.target.value) || undefined })}
          />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label className="field-label">Alignment</label>
          <select
            value={typo.align ?? "left"}
            onChange={(e) => setTypo({ align: e.target.value as "left" })}
          >
            <option value="left">Left (ragged)</option>
            <option value="justify">Justified</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">First-line indent (in)</label>
          <input
            type="number"
            min={0}
            max={3}
            step={0.05}
            value={typo.firstLineIndentIn ?? ""}
            onChange={(e) => setTypo({ firstLineIndentIn: Number(e.target.value) || undefined })}
          />
        </div>
      </div>

      <div className="modal-actions">
        {template.builtinKey ? (
          <span className="muted" style={{ fontSize: 12 }}>
            Built-in — editable, but can&rsquo;t be deleted.
          </span>
        ) : (
          <button className="btn ghost" type="button" onClick={() => void remove()}>
            <Trash2 size={14} /> Delete
          </button>
        )}
        <div className="spacer" />
        <button className="btn" type="button" onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : "Save template"}
        </button>
      </div>
    </>
  );
}

/**
 * Which break each outline depth uses. Levels belong to a work rather than to
 * the app — two novels can be structured differently — so this edits one work
 * at a time, chosen here.
 */
export function LevelsPane({ templates }: { templates: Template[] }) {
  const [works, setWorks] = useState<{ id: string; title: string }[]>([]);
  const [workId, setWorkId] = useState<string>("");
  const [levels, setLevels] = useState<
    { name: string; breakTemplateId: string | null; counterRestart: "continuous" | "under-parent" }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const breaks = useMemo(() => templates.filter((t) => t.category === "break"), [templates]);

  useEffect(() => {
    void api.listWorks().then(({ works: rows }) => {
      setWorks(rows.map((w) => ({ id: w.id, title: w.title })));
      if (rows[0]) setWorkId(rows[0].id);
    });
  }, []);

  const load = useCallback(async (id: string) => {
    const { levels: rows } = await api.listLevels(id);
    setLevels(
      rows.map((l) => ({
        name: l.name,
        breakTemplateId: l.breakTemplateId,
        counterRestart: l.counterRestart,
      })),
    );
  }, []);

  useEffect(() => {
    if (workId) void load(workId);
  }, [workId, load]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await api.saveLevels(workId, levels);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save levels");
    } finally {
      setBusy(false);
    }
  }

  const set = (i: number, patch: Partial<(typeof levels)[number]>) => {
    setSaved(false);
    setLevels(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  };

  return (
    <>
      <p className="card-subtitle">
        The outline&rsquo;s depth is the index into this list. Depth 0 is the outermost — set it to
        Chapter and the next to Scene, or add a Part above them. Moving a block between indentations
        changes which level it takes, and so which break renders before it.
      </p>

      {error ? <div className="alert error">{error}</div> : null}
      {saved ? <div className="alert ok">Levels saved.</div> : null}

      <div className="field">
        <label className="field-label" htmlFor="levelWork">
          Work
        </label>
        <select id="levelWork" value={workId} onChange={(e) => setWorkId(e.target.value)}>
          {works.map((w) => (
            <option key={w.id} value={w.id}>
              {w.title}
            </option>
          ))}
        </select>
      </div>

      <div className="level-rows">
        {levels.map((level, i) => (
          <div className="level-row" key={i}>
            <span className="level-depth">{i}</span>
            <input
              type="text"
              value={level.name}
              placeholder="Chapter"
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <select
              value={level.breakTemplateId ?? ""}
              onChange={(e) => set(i, { breakTemplateId: e.target.value || null })}
            >
              <option value="">No break</option>
              {breaks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select
              value={level.counterRestart}
              onChange={(e) =>
                set(i, { counterRestart: e.target.value as "continuous" | "under-parent" })
              }
              title="Numbering"
            >
              <option value="continuous">Number continuously</option>
              <option value="under-parent">Restart under each parent</option>
            </select>
            <button
              className="btn ghost"
              type="button"
              title="Remove level"
              disabled={levels.length <= 1}
              onClick={() => {
                setSaved(false);
                setLevels(levels.filter((_, j) => j !== i));
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      <div className="modal-actions">
        <button
          className="btn secondary"
          type="button"
          onClick={() => {
            setSaved(false);
            setLevels([...levels, { name: "", breakTemplateId: null, counterRestart: "continuous" }]);
          }}
        >
          <Plus size={14} /> Add level
        </button>
        <div className="spacer" />
        <button className="btn" type="button" onClick={() => void save()} disabled={busy || !workId}>
          {busy ? "Saving…" : "Save levels"}
        </button>
      </div>
    </>
  );
}
