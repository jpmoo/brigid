import { useEffect, useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { buildOutline } from "@brigid/shared";
import { ApiError, api } from "../../api.js";
import type { Block, Template } from "../../api.js";

/**
 * Turning a manuscript into something to submit.
 *
 * Almost nothing is asked for. How it is set — the face, the spacing, the
 * indent — is already decided by the formats, and asking again here would only
 * be a second place for it to be wrong. What is left is what belongs to the
 * submission rather than to the writing: which parts of it, whose name goes
 * across the top, and what kind of file.
 */
export function CompilePane({
  workId,
  blocks,
  templates,
  work,
}: {
  workId: string;
  blocks: Block[];
  templates: Template[];
  work: { title: string } | null;
}) {
  const entries = useMemo(() => buildOutline(blocks), [blocks]);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [runningHeads, setRunningHeads] = useState(true);
  const [shortTitle, setShortTitle] = useState("");
  const [format, setFormat] = useState<"docx" | "pdf">("docx");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Everything, until told otherwise.
  useEffect(() => {
    setInclude(new Set(blocks.map((b) => b.id)));
  }, [blocks]);

  const formatName = (block: Block) =>
    templates.find((t) => t.id === block.formatId)?.name ?? "Block";

  const trimmed = shortTitle.trim();
  const oneWord = trimmed.length > 0 && !/\s/.test(trimmed);
  // Only a running head needs one. Without heads there is nowhere to put it.
  const ready = (!runningHeads || oneWord) && include.size > 0 && !busy;

  function toggle(id: string) {
    setInclude((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function compile() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { blob, filename } = await api.compileWork(workId, {
        format,
        include: [...include],
        runningHeads,
        ...(trimmed ? { shortTitle: trimmed } : {}),
      });
      // Handed to the browser as a download rather than opened: this is a file
      // to attach to a submission, not something to read here.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setDone(filename);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tpl-detail">
      <h4 className="tpl-section">What to include</h4>
      <div className="be-line">
        <button
          className="btn ghost"
          type="button"
          onClick={() => setInclude(new Set(blocks.map((b) => b.id)))}
        >
          All
        </button>
        <button className="btn ghost" type="button" onClick={() => setInclude(new Set())}>
          None
        </button>
        <span className="muted small">
          {include.size} of {blocks.length}
        </span>
      </div>

      <div className="compile-list">
        {entries.map((entry) => (
          <label
            key={entry.block.id}
            className="compile-item"
            style={{ paddingLeft: 8 + entry.depth * 16 }}
          >
            <input
              type="checkbox"
              checked={include.has(entry.block.id)}
              onChange={() => toggle(entry.block.id)}
            />
            <span className="compile-label">{entry.block.label || <em>Untitled</em>}</span>
            <span className="compile-kind">{formatName(entry.block)}</span>
          </label>
        ))}
      </div>

      <h4 className="tpl-section">Running heads</h4>
      <div className="stack">
        <label className="check">
          <input
            type="checkbox"
            checked={runningHeads}
            onChange={(e) => setRunningHeads(e.target.checked)}
          />
          <span>
            Shunn-style heads <em>&mdash; surname, short title and page, top right</em>
          </span>
        </label>
      </div>

      {runningHeads ? (
        <>
          <div className="be-line" style={{ marginTop: 8 }}>
            <label className="bk-field">
              <span>Short title</span>
              <input
                type="text"
                value={shortTitle}
                spellCheck={false}
                placeholder="One word"
                onChange={(e) => setShortTitle(e.target.value)}
              />
            </label>
            {trimmed && !oneWord ? (
              <span className="compile-warn">One word, no spaces.</span>
            ) : null}
          </div>
          <p className="tpl-note">
            A head is read at a glance, so it wants a word rather than a title.{" "}
            {work ? <>&ldquo;{work.title}&rdquo; stays on the title page.</> : null} It names
            the file too. The title page carries no head and is not page one; the writing
            starts the count.
          </p>
        </>
      ) : (
        <p className="tpl-note">
          Without heads the title page still carries none, and is still not page one.
        </p>
      )}

      <h4 className="tpl-section">The file</h4>
      <div className="be-line">
        <div className="segmented compact" role="group" aria-label="File type">
          <button type="button" aria-pressed={format === "docx"} onClick={() => setFormat("docx")}>
            Word
          </button>
          <button type="button" aria-pressed={format === "pdf"} onClick={() => setFormat("pdf")}>
            PDF
          </button>
        </div>
        <span className="be-gap" />
        <button className="btn" type="button" disabled={!ready} onClick={() => void compile()}>
          <FileDown size={15} />
          {busy ? "Compiling…" : "Compile"}
        </button>
      </div>
      <p className="tpl-note">
        One-inch margins all round. The face, size and spacing come from the formats, so
        there is nothing to set here.
      </p>

      {error ? <div className="alert error">{error}</div> : null}
      {done ? <div className="alert ok">Compiled — {done}</div> : null}
    </div>
  );
}
