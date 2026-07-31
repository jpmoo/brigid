import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api.js";
import type { SetupDatabase } from "../api.js";
import { Brand } from "../components/Brand.js";
import { useAuth } from "../auth/AuthContext.js";

type Mode = "existing" | "provision";

/**
 * First run. Establishes the database, creates the single account, and signs the
 * writer straight in — the server does all of it in one call, so a failure
 * part-way leaves nothing half-configured to reason about.
 */
export function SetupPage() {
  const { refresh } = useAuth();
  const [mode, setMode] = useState<Mode>("existing");

  const [url, setUrl] = useState("postgres://brigid:@localhost:5432/brigid");
  const [adminHost, setAdminHost] = useState("localhost");
  const [adminPort, setAdminPort] = useState("5432");
  const [adminUser, setAdminUser] = useState("postgres");
  const [adminPassword, setAdminPassword] = useState("");
  const [dbName, setDbName] = useState("brigid");
  const [dbUser, setDbUser] = useState("brigid");
  const [dbPassword, setDbPassword] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function database(): SetupDatabase {
    if (mode === "existing") return { mode: "existing", url };
    return {
      mode: "provision",
      admin: {
        host: adminHost,
        port: Number(adminPort),
        user: adminUser,
        password: adminPassword,
        database: "postgres",
      },
      app: { dbName, user: dbUser, password: dbPassword },
    };
  }

  async function onTest() {
    setError(null);
    setTested(null);
    setBusy(true);
    try {
      await api.testConnection(url);
      setTested("Connected.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not connect");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("the two passwords don't match");
      return;
    }
    if (password.length < 10) {
      setError("password must be at least 10 characters");
      return;
    }

    setBusy(true);
    try {
      await api.completeSetup(database(), { username, password });
      // The server signed us in as part of that call; re-reading state flips the
      // app straight to the library.
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "setup failed");
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="screen-inner wide">
        <Brand tagline="Let's set up your library." />

        <form className="card" onSubmit={onSubmit}>
          <h2 className="card-title">Connect a database</h2>
          <p className="card-subtitle">
            Brigid keeps everything in PostgreSQL. Point it at a database you've already made, or
            let it create one.
          </p>

          <div className="segmented">
            <button
              type="button"
              aria-pressed={mode === "existing"}
              onClick={() => {
                setMode("existing");
                setError(null);
              }}
            >
              Use existing
            </button>
            <button
              type="button"
              aria-pressed={mode === "provision"}
              onClick={() => {
                setMode("provision");
                setError(null);
                setTested(null);
              }}
            >
              Create one for me
            </button>
          </div>

          {error ? <div className="alert error">{error}</div> : null}
          {tested ? <div className="alert ok">{tested}</div> : null}

          {mode === "existing" ? (
            <>
              <div className="field">
                <label className="field-label" htmlFor="url">
                  Connection string
                </label>
                <input
                  id="url"
                  type="text"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setTested(null);
                  }}
                  required
                />
                <p className="field-hint">
                  Special characters in the password must be percent-encoded — <code>@</code>{" "}
                  becomes <code>%40</code>.
                </p>
              </div>
              <button className="btn secondary" type="button" onClick={onTest} disabled={busy}>
                Test connection
              </button>
            </>
          ) : (
            <>
              <p className="field-hint" style={{ marginBottom: 14 }}>
                Needs a PostgreSQL superuser that accepts password login over TCP. On Ubuntu the
                <code> postgres</code> role usually doesn't — if this fails, create the database by
                hand and switch to "Use existing".
              </p>
              <div className="row">
                <div className="field">
                  <label className="field-label" htmlFor="adminHost">
                    Host
                  </label>
                  <input
                    id="adminHost"
                    type="text"
                    value={adminHost}
                    onChange={(e) => setAdminHost(e.target.value)}
                    required
                  />
                </div>
                <div className="field" style={{ maxWidth: 110 }}>
                  <label className="field-label" htmlFor="adminPort">
                    Port
                  </label>
                  <input
                    id="adminPort"
                    type="number"
                    value={adminPort}
                    onChange={(e) => setAdminPort(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label className="field-label" htmlFor="adminUser">
                    Admin user
                  </label>
                  <input
                    id="adminUser"
                    type="text"
                    value={adminUser}
                    onChange={(e) => setAdminUser(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="adminPassword">
                    Admin password
                  </label>
                  <input
                    id="adminPassword"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label className="field-label" htmlFor="dbName">
                    New database
                  </label>
                  <input
                    id="dbName"
                    type="text"
                    value={dbName}
                    onChange={(e) => setDbName(e.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="dbUser">
                    New role
                  </label>
                  <input
                    id="dbUser"
                    type="text"
                    value={dbUser}
                    onChange={(e) => setDbUser(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="dbPassword">
                  Password for the new role
                </label>
                <input
                  id="dbPassword"
                  type="password"
                  value={dbPassword}
                  onChange={(e) => setDbPassword(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          <hr
            style={{
              border: 0,
              borderTop: "1px solid var(--border)",
              margin: "24px 0 22px",
            }}
          />

          <h2 className="card-title">Create your account</h2>
          <p className="card-subtitle">
            Brigid is built for one writer. This is the only account there will be.
          </p>

          <div className="field">
            <label className="field-label" htmlFor="setupUsername">
              Username
            </label>
            <input
              id="setupUsername"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="row">
            <div className="field">
              <label className="field-label" htmlFor="setupPassword">
                Password
              </label>
              <input
                id="setupPassword"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <p className="field-hint">At least 10 characters.</p>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="setupConfirm">
                Confirm password
              </label>
              <input
                id="setupConfirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          </div>

          <button className="btn full" type="submit" disabled={busy}>
            {busy ? "Setting up…" : "Set up Brigid"}
          </button>
        </form>
      </div>
    </div>
  );
}
