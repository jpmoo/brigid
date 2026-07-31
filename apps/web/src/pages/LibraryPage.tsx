import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Archive, BookOpen, LogOut, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError, api } from "../api.js";
import type { Work } from "../api.js";
import { BrandHeading, BrandMark } from "../components/Brand.js";
import { useAuth } from "../auth/AuthContext.js";

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
  const [creating, setCreating] = useState(false);

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
            <button className="btn" type="button" onClick={() => setCreating(true)}>
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
                    title={work.archivedAt ? "Restore" : "Archive"}
                    onClick={() => void onArchive(work)}
                  >
                    <Archive size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

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
