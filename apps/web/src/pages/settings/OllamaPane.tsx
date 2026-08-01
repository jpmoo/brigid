import { useEffect, useState } from "react";
import { Plug, RefreshCw } from "lucide-react";
import { ApiError, api } from "../../api.js";
import { useSavedFlash } from "../../useSavedFlash.js";

const PLACEHOLDER = "http://localhost:11434";

/**
 * Where the model lives.
 *
 * Two steps in one panel, because they are one decision: say where Ollama is,
 * and the list of what it has installed comes back. Nothing is saved by
 * connecting — a host that turns out to be the wrong one shouldn't be kept.
 */
export function OllamaPane() {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [numCtx, setNumCtx] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, flash] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);

  /**
   * A host that was saved before was reachable then, so its models are fetched
   * without being asked for. If it has since gone away that is worth knowing,
   * but it isn't an error to be shouted about on arriving at the page.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const settings = await api.getOllama();
        if (!alive) return;
        setUrl(settings.url ?? "");
        setModel(settings.analysisModel);
        setNumCtx(settings.numCtx ?? null);
        if (settings.url) {
          const { models: found } = await api.listOllamaModels(settings.url);
          if (alive) setModels(found);
        }
      } catch {
        // Left to the writer to press Connect.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const { models: found } = await api.listOllamaModels(url.trim() || PLACEHOLDER);
      setModels(found);
      // A model chosen against the old host may not exist on this one.
      if (model && !found.includes(model)) setModel(null);
    } catch (err) {
      setModels(null);
      setError(err instanceof ApiError ? err.message : "could not reach that host");
    } finally {
      setConnecting(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await api.saveOllama({
        url: url.trim() ? url.trim() : null,
        analysisModel: model,
      });
      setUrl(next.url ?? "");
      setModel(next.analysisModel);
      setNumCtx(next.numCtx ?? null);
      flash();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save that");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="tpl-note">Loading&hellip;</p>;

  return (
    <div className="tpl-detail">
      <h3 className="card-title">Ollama</h3>
      <p className="card-subtitle">
        Brigid asks a model of your own, running wherever you keep it. Nothing leaves
        the machines you control.
      </p>

      <h4 className="tpl-section">Host</h4>
      <div className="be-line be-line-setting" style={{ marginTop: 8 }}>
        <label className="bk-field" style={{ flex: 1 }}>
          <span>Address</span>
          <input
            type="url"
            style={{ flex: 1, minWidth: 220 }}
            placeholder={PLACEHOLDER}
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void connect();
              }
            }}
          />
        </label>
        <button className="btn secondary" type="button" disabled={connecting} onClick={() => void connect()}>
          {models ? <RefreshCw size={14} /> : <Plug size={14} />}
          {connecting ? "Connecting…" : models ? "Refresh" : "Connect"}
        </button>
      </div>
      <p className="tpl-note">
        The host and port Ollama answers on &mdash; usually {PLACEHOLDER} when it runs
        alongside Brigid.
      </p>

      {error ? <div className="alert error">{error}</div> : null}

      {models ? (
        <>
          <h4 className="tpl-section">Analysis model</h4>
          {models.length === 0 ? (
            <p className="tpl-note">
              That host is Ollama, but it has no models installed yet. Pull one over
              there &mdash; <code>ollama pull llama3.1</code> &mdash; then refresh.
            </p>
          ) : (
            <>
              <div className="be-line be-line-setting" style={{ marginTop: 8 }}>
                <label className="bk-field">
                  <span>Use</span>
                  <select value={model ?? ""} onChange={(e) => setModel(e.target.value || null)}>
                    <option value="">Choose a model</option>
                    {models.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="tpl-note">
                {models.length === 1 ? "One model" : `${models.length} models`} installed
                on that host. This is the one Brigid will think with.
              </p>

              {/* Ollama serves a small default window regardless of what the
                  model can hold, and exceeding it truncates silently — so what
                  was actually detected is worth showing rather than trusting. */}
              {model ? (
                numCtx ? (
                  <p className="tpl-note">
                    Using its full context window of{" "}
                    <strong>{numCtx.toLocaleString()} tokens</strong>. Ollama would
                    otherwise serve a fraction of that and quietly cut off the rest of
                    each chapter.
                  </p>
                ) : (
                  <p className="tpl-note">
                    This host didn&rsquo;t report the model&rsquo;s context window, so
                    Ollama&rsquo;s default applies &mdash; which is small, and truncates
                    long sections without saying so. Brigid will ask again as it reads;
                    if it keeps saying this, the host may be an older Ollama.
                  </p>
                )
              ) : null}
            </>
          )}
        </>
      ) : null}

      <div className="be-line" style={{ marginTop: 10 }}>
        <button className="btn" type="button" disabled={saving || saved} onClick={() => void save()}>
          {saved ? "Saved!" : saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
