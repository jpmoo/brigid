import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ApiError, api } from "../api.js";
import { BrandHeading, BrandMark } from "../components/Brand.js";
import { useAuth } from "../auth/AuthContext.js";

export function SettingsPage() {
  const { username } = useAuth();

  return (
    <>
      <header className="app-header">
        <Link className="btn ghost" to="/" title="Back to library">
          <ArrowLeft size={16} />
        </Link>
        <BrandMark />
        <BrandHeading />
        <div className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>
          {username}
        </span>
      </header>

      <main className="page">
        <div className="page-head">
          <h2>Settings</h2>
        </div>

        <PasswordCard />

        <div className="card" style={{ marginTop: 18 }}>
          <h3 className="card-title">Ollama</h3>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            Brigid will connect to an Ollama host and let you pick a model for inference and
            another for summarization. Not built yet — the settings row is in the database waiting
            for it.
          </p>
        </div>
      </main>
    </>
  );
}

function PasswordCard() {
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
    <form className="card" onSubmit={onSubmit}>
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
