import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ApiError, api } from "../api.js";
import type { Block, Template, Work } from "../api.js";
import { LevelsEditor } from "../components/LevelsEditor.js";
import { TemplatesPane } from "./settings/TemplatesPane.js";
import { SpellingPane } from "./settings/SpellingPane.js";
import { BackupPane } from "./settings/BackupPane.js";
import { CompilePane } from "./settings/CompilePane.js";
import { BrandHeading, BrandMark } from "../components/Brand.js";
import { useAuth } from "../auth/AuthContext.js";
import { ThemeToggle } from "../components/ThemeToggle.js";

const TABS = [
  { key: "templates", label: "Formats" },
  { key: "spelling", label: "Spelling" },
  { key: "backup", label: "Backup" },
  { key: "account", label: "Account" },
  { key: "ollama", label: "Ollama" },
] as const;

type TabKey = (typeof TABS)[number]["key"] | "project";

const PROJECT_TABS = [
  { key: "levels", label: "Levels" },
  { key: "compile", label: "Compile" },
] as const;

type ProjectTabKey = (typeof PROJECT_TABS)[number]["key"];

export function SettingsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("templates");
  const [projectTab, setProjectTab] = useState<ProjectTabKey>("levels");
  const [templates, setTemplates] = useState<Template[]>([]);

  /**
   * Settings reached from inside a manuscript carries which one, and gains a
   * tab for the things that belong to it rather than to the app. Opened from
   * the library there is no such thing, so the tab isn't offered.
   */
  const [params] = useSearchParams();
  const workId = params.get("work");
  const [work, setWork] = useState<Work | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);

  useEffect(() => {
    if (!workId) return;
    void (async () => {
      const [{ work: w }, { blocks: bs }] = await Promise.all([
        api.getWork(workId),
        api.listBlocks(workId),
      ]);
      setWork(w);
      setBlocks(bs);
    })();
  }, [workId]);

  const loadTemplates = useCallback(async () => {
    const { templates: rows } = await api.listTemplates();
    setTemplates(rows);
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  // Back to wherever the writer came from — usually the work they were in the
  // middle of, not the library. react-router records its position in history
  // state; index 0 means this was opened directly and there is nothing behind
  // it, so fall back to the library rather than leaving the app.
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/");
  };

  return (
    <>
      <header className="app-header">
        <BrandMark />
        <BrandHeading />
        <div className="spacer" />
        <ThemeToggle />
      </header>

      <main className="page">
        <button className="btn secondary back-link" type="button" onClick={goBack}>
          <ArrowLeft size={15} />
          Back
        </button>

        <div className="page-head">
          <h2>Settings</h2>
        </div>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? "selected" : ""}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
          {workId ? (
            <>
              <span className="tab-gap" />
              <button
                type="button"
                role="tab"
                aria-selected={tab === "project"}
                className={tab === "project" ? "selected" : ""}
                onClick={() => setTab("project")}
              >
                Project Settings
              </button>
            </>
          ) : null}
        </nav>

        <div className="card tab-panel" role="tabpanel">
          {tab === "templates" ? (
            <TemplatesPane templates={templates} onReload={() => void loadTemplates()} />
          ) : tab === "spelling" ? (
            <SpellingPane />
          ) : tab === "backup" ? (
            <BackupPane workId={workId} />
          ) : tab === "project" ? (
            workId ? (
              <>
                <p className="card-subtitle">
                  {work ? `Settings for “${work.title}”.` : "Settings for this manuscript."} These
                  belong to the manuscript, not to Brigid.
                </p>

                <nav className="subtabs" role="tablist">
                  {PROJECT_TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={projectTab === t.key}
                      className={projectTab === t.key ? "selected" : ""}
                      onClick={() => setProjectTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>

                {projectTab === "levels" ? (
                  <LevelsEditor workId={workId} blocks={blocks} templates={templates} />
                ) : (
                  <CompilePane
                    workId={workId}
                    blocks={blocks}
                    templates={templates}
                    work={work}
                  />
                )}
              </>
            ) : null
          ) : tab === "account" ? (
            <PasswordFields />
          ) : (
            <>
              <h3 className="card-title">Ollama</h3>
              <p className="card-subtitle" style={{ marginBottom: 0 }}>
                Brigid will connect to an Ollama host and let you pick a model for inference and
                another for summarization. Not built yet — the settings row is in the database
                waiting for it.
              </p>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function PasswordFields() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("the two passwords don't match");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not change the password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h3 className="card-title">Password</h3>
      <p className="card-subtitle">Brigid has one account, and this is its password.</p>

      {error ? <div className="alert error">{error}</div> : null}
      {done ? <div className="alert ok">Password changed.</div> : null}

      <div className="field">
        <label className="field-label" htmlFor="currentPassword">
          Current password
        </label>
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>

      <div className="row">
        <div className="field">
          <label className="field-label" htmlFor="newPassword">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <p className="field-hint">At least 10 characters.</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="confirmPassword">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
      </div>

      <button className="btn" type="submit" disabled={busy}>
        {busy ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}
