import { useMemo, useRef, useState } from "react";
import { FileUp, Plus, Trash2 } from "lucide-react";
import { planImport, suggestMarkers } from "@brigid/shared";
import type { ImportedParagraph } from "@brigid/shared";
import { ApiError, api } from "../api.js";
import type { Template, Work } from "../api.js";

interface MarkerRow {
  name: string;
  prefix: string;
  breakTemplateId: string | null;
  counterRestart: "continuous" | "under-parent";
}

/**
 * Import a Word document as a new work.
 *
 * The writer describes their own manuscript's conventions — the literal string
 * each chapter starts with, the string that separates scenes — and those become
 * the outline. Matching is case sensitive, which is the point: "CHAPTER ONE" is
 * a heading and "chapter" in a sentence is not.
 */
export function ImportWizard({
  templates,
  onClose,
  onCreated,
}: {
  templates: Template[];
  onClose: () => void;
  onCreated: (work: Work) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [paragraphs, setParagraphs] = useState<ImportedParagraph[]>([]);
  const [hasPageBreaks, setHasPageBreaks] = useState(false);

  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [firstPageIsTitlePage, setFirstPageIsTitlePage] = useState(false);

  const breaks = useMemo(() => templates.filter((t) => t.category === "break"), [templates]);
  // Empty until a file is read: the rows come from what the document actually
  // contains, not from an assumption about how manuscripts are usually written.
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  const [detected, setDetected] = useState<{ prefix: string; count: number; samples: string[] }[]>(
    [],
  );
  const [titleParas, setTitleParas] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Planned locally as the writer types, so the effect of a marker is visible
  // before anything is written to the database.
  const preview = useMemo(() => {
    if (paragraphs.length === 0) return null;
    return planImport({
      paragraphs,
      firstPageIsTitlePage,
      ...(titleParas !== null ? { titlePageParagraphs: titleParas } : {}),
      markers: markers.map((m, i) => ({ depth: i, name: m.name, prefix: m.prefix })),
    });
  }, [paragraphs, markers, firstPageIsTitlePage, titleParas]);

  async function onFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const result = await api.analyzeDocx(file);
      setFilename(result.filename);
      setParagraphs(result.paragraphs);
      setHasPageBreaks(result.hasPageBreaks);
      setFirstPageIsTitlePage(result.hasPageBreaks);
      setTitleParas(result.hasPageBreaks ? null : 3);
      if (!title) setTitle(result.filename.replace(/\.docx$/i, ""));

      const found = suggestMarkers(result.paragraphs);
      setDetected(found.map((f) => ({ prefix: f.prefix, count: f.count, samples: f.samples })));
      const chapterBreak = breaks.find((b) => b.builtinKey === "chapter-break")?.id ?? null;
      const sectionBreak = breaks.find((b) => b.builtinKey === "section-break")?.id ?? null;
      setMarkers(
        found.slice(0, 3).map((f, i) => ({
          name: f.kind === "exact" ? "Scene" : "Chapter",
          prefix: f.prefix,
          breakTemplateId: f.kind === "exact" ? sectionBreak : chapterBreak,
          counterRestart: f.kind === "exact" ? "under-parent" : "continuous",
        })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not read that file");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setError(null);
    setBusy(true);
    try {
      const { work } = await api.createFromImport({
        title,
        subtitle: subtitle || null,
        authorFirstName: first || null,
        authorLastName: last || null,
        paragraphs,
        firstPageIsTitlePage,
        ...(titleParas !== null ? { titlePageParagraphs: titleParas } : {}),
        markers: markers
          .filter((m) => m.prefix.trim().length > 0)
          .map((m, i) => ({
            depth: i,
            name: m.name || `Level ${i + 1}`,
            prefix: m.prefix,
            breakTemplateId: m.breakTemplateId,
            counterRestart: m.counterRestart,
          })),
      });
      onCreated(work);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "import failed");
      setBusy(false);
    }
  }

  const set = (i: number, patch: Partial<MarkerRow>) =>
    setMarkers(markers.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title">Import a Word document</h2>
        <p className="card-subtitle">
          Brigid reads the paragraphs and uses your own markers to find the structure.
        </p>

        {error ? <div className="alert error">{error}</div> : null}

        <div className="modal-body">
        {paragraphs.length === 0 ? (
          <div className="import-drop">
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            <FileUp size={26} />
            <p>Choose a .docx file.</p>
            <button className="btn" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Reading…" : "Choose file"}
            </button>
            <p className="field-hint">
              Only Word&rsquo;s .docx format. Old .doc files need saving as .docx first.
            </p>
          </div>
        ) : (
          <>
            <p className="import-summary">
              <strong>{filename}</strong> — {paragraphs.length.toLocaleString()} paragraphs
            </p>

            <div className="row">
              <div className="field">
                <label className="field-label">Title</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>
              <div className="field">
                <label className="field-label">Subtitle</label>
                <input type="text" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label className="field-label">Author first name</label>
                <input type="text" value={first} onChange={(e) => setFirst(e.target.value)} />
              </div>
              <div className="field">
                <label className="field-label">Author last name</label>
                <input type="text" value={last} onChange={(e) => setLast(e.target.value)} />
              </div>
            </div>

            <label className="check" style={{ marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={firstPageIsTitlePage}
                onChange={(e) => setFirstPageIsTitlePage(e.target.checked)}
              />
              <span>
                Start with a title page{" "}
                <em>— reproduced word for word, no variables inferred</em>
              </span>
            </label>

            {firstPageIsTitlePage ? (
              <div className="title-bound">
                <label className="check">
                  <input
                    type="radio"
                    name="titlebound"
                    checked={titleParas === null}
                    disabled={!hasPageBreaks}
                    onChange={() => setTitleParas(null)}
                  />
                  <span>
                    Up to the first page break{" "}
                    {hasPageBreaks ? null : <em>— none found in this document</em>}
                  </span>
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="titlebound"
                    checked={titleParas !== null}
                    onChange={() => setTitleParas(titleParas ?? 3)}
                  />
                  <span>The first</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  className="title-count"
                  value={titleParas ?? 3}
                  disabled={titleParas === null}
                  onChange={(e) => setTitleParas(Math.max(1, Number(e.target.value) || 1))}
                />
                <span className="muted">paragraphs</span>
              </div>
            ) : null}

            <h4 className="tpl-section">Markers</h4>
            {detected.length > 0 ? (
              <div className="alert ok" style={{ marginBottom: 10 }}>
                Found in your document:{" "}
                {detected.map((d, i) => (
                  <span key={d.prefix}>
                    {i > 0 ? ", " : ""}
                    <code>{d.prefix}</code> ×{d.count}
                  </span>
                ))}
                . Adjust anything that isn&rsquo;t right.
              </div>
            ) : (
              <div className="alert error" style={{ marginBottom: 10 }}>
                Nothing repeated often enough to look like a marker. Type your own below.
              </div>
            )}
            <p className="field-hint" style={{ marginBottom: 10 }}>
              A paragraph starting with one of these opens a new level.{" "}
              <strong>Case sensitive</strong>, and the marker line itself is replaced by the break.
            </p>

            <div className="level-rows">
              {markers.map((m, i) => (
                <div className="level-row" key={i}>
                  <span className="level-depth">{i}</span>
                  <input
                    type="text"
                    value={m.name}
                    placeholder="Chapter"
                    onChange={(e) => set(i, { name: e.target.value })}
                  />
                  <input
                    type="text"
                    className="marker-input"
                    value={m.prefix}
                    placeholder="CHAPTER "
                    onChange={(e) => set(i, { prefix: e.target.value })}
                  />
                  <select
                    value={m.breakTemplateId ?? ""}
                    onChange={(e) => set(i, { breakTemplateId: e.target.value || null })}
                  >
                    <option value="">No break</option>
                    {breaks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <span className="marker-count">
                    {preview?.matches[i]?.count ?? 0} found
                  </span>
                  <button
                    className="btn ghost"
                    type="button"
                    title="Remove"
                    disabled={markers.length <= 1}
                    onClick={() => setMarkers(markers.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>

            {markers.length === 0 ? (
              <p className="field-hint">No markers yet — add one below.</p>
            ) : null}

            <button
              className="btn secondary"
              type="button"
              style={{ marginTop: 10 }}
              onClick={() =>
                setMarkers([
                  ...markers,
                  { name: "", prefix: "", breakTemplateId: null, counterRestart: "continuous" },
                ])
              }
            >
              <Plus size={13} /> Add level
            </button>

            {preview ? (
              <>
                <h4 className="tpl-section">Preview</h4>
                <div className="import-preview">
                  {preview.titlePage && preview.titlePage.length > 0 ? (
                    <div className="ip-row title">
                      <span className="ip-kind">Title page</span>
                      <span>{preview.titlePage.join(" · ")}</span>
                    </div>
                  ) : null}
                  {preview.blocks.slice(0, 40).map((b, i) => (
                    <div className="ip-row" key={i} style={{ paddingLeft: 12 + b.depth * 16 }}>
                      <span className="ip-kind">{markers[b.depth]?.name || `L${b.depth}`}</span>
                      <span className="ip-label">{b.label ?? <em>untitled</em>}</span>
                      <span className="ip-count">{b.paragraphs.length} ¶</span>
                    </div>
                  ))}
                  {preview.blocks.length > 40 ? (
                    <div className="ip-row muted">
                      …and {preview.blocks.length - 40} more blocks
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        )}

        </div>

        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <div className="spacer" />
          {paragraphs.length > 0 ? (
            <button
              className="btn"
              type="button"
              disabled={busy || !title.trim()}
              onClick={() => void create()}
            >
              {busy ? "Importing…" : `Import ${preview?.blocks.length ?? 0} blocks`}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
