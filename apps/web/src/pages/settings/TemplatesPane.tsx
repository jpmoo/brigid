import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { BlockFormatSettings, BreakTemplateSettings, TemplateBody } from "@brigid/shared";
import { ApiError, api } from "../../api.js";
import type { Template } from "../../api.js";
import { Check } from "lucide-react";
import { useDialogs } from "../../components/Dialogs.js";
import { useSavedFlash } from "../../useSavedFlash.js";
import { FormatFields } from "../../components/FormatFields.js";

/** Stand-ins so a preview in Settings has something to set. */
const SAMPLE_WORK = {
  title: "Manuscript Title",
  subtitle: "A Subtitle",
  authorFirstName: "First",
  authorLastName: "Last",
};

const EMPTY_BREAK: BreakTemplateSettings = { suppressOnFirstChild: false, indentFirstParagraph: false };
const EMPTY_FORMAT: BlockFormatSettings = {
  countsTowardWordCount: true,
  structural: true,
};

export function TemplatesPane({ templates, onReload }: { templates: Template[]; onReload: () => void }) {
  const dialogs = useDialogs();
  const [selectedId, setSelectedId] = useState<string | null>(templates[0]?.id ?? null);
  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const breaks = templates.filter((t) => t.category === "break");
  const formats = templates.filter((t) => t.category === "block-format");

  async function create(category: "break" | "block-format") {
    const answer = await dialogs.prompt({
      title: category === "break" ? "New break format" : "New block format",
      fields: [{ label: "Name", placeholder: category === "break" ? "Subsection break" : "Epigraph" }],
      confirmLabel: "Create",
    });
    const name = answer?.[0]?.trim();
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
            <span>Break formats</span>
            <button className="btn ghost" type="button" title="New break format" onClick={() => void create("break")}>
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
              title="New block format"
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
          <p className="tpl-empty">Pick a format on the left.</p>
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
  const dialogs = useDialogs();
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState<TemplateBody>(template.body);
  const [brk, setBrk] = useState<BreakTemplateSettings>(template.breakSettings ?? EMPTY_BREAK);
  const [fmt, setFmt] = useState<BlockFormatSettings>(template.formatSettings ?? EMPTY_FORMAT);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, flashSaved] = useSavedFlash();
  const [busy, setBusy] = useState(false);

  const isBreak = template.category === "break";
  // A format whose body is just the content slot has no layout to arrange —
  // only type. It edits as a style menu over a sample instead.
  const isStyleOnly =
    !isBreak && body.nodes.length === 1 && body.nodes[0]?.type === "content";
  const typo = (isBreak ? brk.typography : fmt.typography) ?? {};
  const setTypo = (next: NonNullable<BreakTemplateSettings["typography"]>) => {
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
      flashSaved();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = await dialogs.confirm({
      title: `Delete “${template.name}”?`,
      message: "This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
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
          }}
        />
      </div>

      <FormatFields
        styleOnly={isStyleOnly}
        body={body}
        onBody={setBody}
        typography={typo}
        onTypography={setTypo}
        work={SAMPLE_WORK}
      />

      <h4 className="tpl-section">Behavior</h4>
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
        </div>
      )}

      {/* No format-wide type here: a layout format sets its face, size and
          spacing per line, where the line is. Only a style format — which has
          no lines of its own — carries type for the whole thing. */}

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
        <button
          className={`btn${savedFlash ? " saved" : ""}`}
          type="button"
          onClick={() => void save()}
          disabled={busy}
        >
          {savedFlash ? (
            <>
              <Check size={15} /> Saved!
            </>
          ) : busy ? (
            "Saving…"
          ) : (
            "Save format"
          )}
        </button>
      </div>
    </>
  );
}
