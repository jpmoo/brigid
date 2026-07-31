import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  FileUp,
  LogOut,
  Plus,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api.js";
import type { Template, Work } from "../api.js";
import { BrandHeading, BrandMark } from "../components/Brand.js";
import { HoldToConfirm } from "../components/HoldToConfirm.js";
import { ImportWizard } from "../components/ImportWizard.js";
import { useAuth } from "../auth/AuthContext.js";
import { ThemeToggle } from "../components/ThemeToggle.js";

const wordFmt = new Intl.NumberFormat();

function byline(work: Work): string | null {
  const name = [work.authorFirstName, work.authorLastName].filter(Boolean).join(" ");
  return name || null;
}

export function LibraryPage() {
  const { username, logout } = useAuth();
  const [works, setWorks] = useState<Work[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "New work" first asks blank or import; the wizard is a different shape of
  // job from a three-field form, so it gets its own screen rather than a mode.
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [deleting, setDeleting] = useState<Work | null>(null);

  const load = useCallback(async () => {
    try {
      const { works: rows } = await api.listWorks(showArchived);
      setWorks(rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not load the library");
      setWorks([]);
    }
  }, [showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api.listTemplates().then(({ templates: rows }) => setTemplates(rows));
  }, []);

  async function onArchive(work: Work) {
    setError(null);
    try {
      await api.archiveWork(work.id, !work.archivedAt);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not archive");
    }
  }

  return (
    <>
      <header className="app-header">
        <BrandMark />
        <BrandHeading />
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>
          {username}
        </span>
        <ThemeToggle />
        <Link className="btn ghost" to="/settings" title="Settings">
          <Settings size={16} />
        </Link>
        <button className="btn ghost" type="button" onClick={() => void logout()} title="Sign out">
          <LogOut size={16} />
        </button>
      </header>

      <main className="page">
        <div className="page-head">
          <h2>{showArchived ? "Archived" : "Library"}</h2>
          <div className="spacer" />
          <button
            className="btn secondary"
            type="button"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Back to library" : "Archived"}
          </button>
          {showArchived ? null : (
            <button className="btn" type="button" onClick={() => setChoosing(true)}>
              <Plus size={16} />
              New work
            </button>
          )}
        </div>

        {error ? <div className="alert error">{error}</div> : null}

        {works === null ? (
          <p className="muted">Loading…</p>
        ) : works.length === 0 ? (
          <div className="empty">
            <h3>{showArchived ? "Nothing archived" : "No works yet"}</h3>
            <p>
              {showArchived
                ? "Works you archive will rest here."
                : "Start something. A title is all you need to begin."}
            </p>
          </div>
        ) : (
          <div className="work-grid">
            {works.map((work) => (
              <div className="work-card" key={work.id}>
                <Link className="work-card-open" to={`/works/${work.id}`}>
                  <h3>{work.title}</h3>
                  {work.subtitle ? <p className="sub">{work.subtitle}</p> : null}
                </Link>
                <div className="meta">
                  <span>
                    <BookOpen size={12} style={{ verticalAlign: -1 }} />{" "}
                    {wordFmt.format(work.wordCount)} words
                  </span>
                  {byline(work) ? <span>{byline(work)}</span> : null}
                  <div className="spacer" />
                  <button
                    className="btn ghost"
                    type="button"
                    title={work.archivedAt ? "Restore to the library" : "Archive"}
                    onClick={() => void onArchive(work)}
                  >
                    {work.archivedAt ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                  </button>
                  {work.archivedAt ? (
                    <button
                      className="btn ghost"
                      type="button"
                      title="Delete permanently"
                      onClick={() => setDeleting(work)}
                    >
                      <Trash2 size={13} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {choosing ? (
        <div className="modal-backdrop" onClick={() => setChoosing(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="card-title">New work</h2>
            <p className="card-subtitle">Start from nothing, or bring in something you&rsquo;ve written.</p>
            <div className="choice-grid">
              <button
                type="button"
                className="choice"
                onClick={() => {
                  setChoosing(false);
                  setCreating(true);
                }}
              >
                <SquarePen size={22} />
                <strong>Blank</strong>
                <span>An empty manuscript with Chapter and Scene levels.</span>
              </button>
              <button
                type="button"
                className="choice"
                onClick={() => {
                  setChoosing(false);
                  setImporting(true);
                }}
              >
                <FileUp size={22} />
                <strong>Import</strong>
                <span>Read a Word document and find its structure.</span>
              </button>
            </div>
            <div className="modal-actions">
              <div className="spacer" />
              <button className="btn secondary" type="button" onClick={() => setChoosing(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importing ? (
        <ImportWizard
          templates={templates}
          onClose={() => setImporting(false)}
          onCreated={() => {
            setImporting(false);
            void load();
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteWorkDialog
          work={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            void load();
          }}
        />
      ) : null}

      {creating ? (
        <NewWorkModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Deleting a manuscript is not undoable and there is no backup inside Brigid,
 * so it takes two deliberate steps: an acknowledgement of exactly what is
 * about to be lost, and then a sustained hold. Only reachable from the archive.
 */
function DeleteWorkDialog({
  work,
  onClose,
  onDeleted,
}: {
  work: Work;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [understood, setUnderstood] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      await api.deleteWork(work.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not delete");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="card-title">Delete &ldquo;{work.title}&rdquo;</h2>
        <p className="card-subtitle">This cannot be undone, and Brigid keeps no copy.</p>

        {error ? <div className="alert error">{error}</div> : null}

        <div className="danger-note">
          <strong>You are about to permanently destroy:</strong>
          <ul>
            <li>{wordFmt.format(work.wordCount)} words</li>
            <li>
              {wordFmt.format(work.blockCount)} block{work.blockCount === 1 ? "" : "s"}, and every
              break attached to them
            </li>
            <li>this work&rsquo;s outline levels</li>
          </ul>
        </div>

        <label className="check" style={{ marginBottom: 18 }}>
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          <span>
            I understand this manuscript will be gone for good.
          </span>
        </label>

        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Keep it
          </button>
          <div className="spacer" />
          <HoldToConfirm
            seconds={3}
            disabled={!understood || busy}
            label={busy ? "Deleting…" : "Hold to delete"}
            holdingLabel="Keep holding to delete…"
            onConfirm={() => void remove()}
          />
        </div>
      </div>
    </div>
  );
}

function NewWorkModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createWork({
        title,
        subtitle: subtitle || null,
        authorFirstName: first || null,
        authorLastName: last || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not create the work");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={onSubmit}>
        <h2 className="card-title">New work</h2>
        <p className="card-subtitle">
          Starts with two levels — Chapter and Scene. You can change them later.
        </p>

        {error ? <div className="alert error">{error}</div> : null}

        <div className="field">
          <label className="field-label" htmlFor="title">
            Title
          </label>
          <input
            id="title"
            type="text"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="subtitle">
            Subtitle
          </label>
          <input
            id="subtitle"
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
          />
        </div>

        <div className="row">
          <div className="field">
            <label className="field-label" htmlFor="first">
              Author first name
            </label>
            <input id="first" type="text" value={first} onChange={(e) => setFirst(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="last">
              Author last name
            </label>
            <input id="last" type="text" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" type="submit" disabled={busy || !title.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
