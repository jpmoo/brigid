import { useEffect, useState } from "react";
import { Plug, RefreshCw } from "lucide-react";
import { ApiError, api } from "../../api.js";
import type { AiProvider } from "../../api.js";
import { useSavedFlash } from "../../useSavedFlash.js";

const PLACEHOLDER = "http://localhost:11434";

/**
 * Where the model lives.
 *
 * Two steps in one panel because they are one decision: say where the server
 * is, and what it can do comes back. Which server it is, the writer is not
 * asked — the address is probed and the answer decides what the rest of the
 * panel offers.
 *
 * Ollama gets a model picker because Ollama can say what it has installed and
 * how large a window each one holds. Everything else gets told what it is
 * serving, because that was settled when the server was started and there is
 * nothing here to choose.
 *
 * Nothing is saved by connecting. A host that turns out to be the wrong one
 * should not be kept.
 */
export function AiModelPane() {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [numCtx, setNumCtx] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);

  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, flash] = useSavedFlash();
  const [error, setError] = useState<string | null>(null);

  /**
   * A host saved before was reachable then, so it is probed again without being
   * asked for. If it has since gone away that is worth knowing, but it is not
   * an error to be shouted about on arriving at the page.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const settings = await api.getAi();
        if (!alive) return;
        setUrl(settings.url ?? "");
        setModel(settings.analysisModel);
        setProvider(settings.provider);
        setNumCtx(settings.numCtx ?? null);
        setHasKey(settings.hasApiKey);

        if (settings.url) {
          const found = await api.detectAi(settings.url).catch(() => null);
          if (alive && found) {
            setModels(found.models);
            setProvider(found.provider);
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const found = await api.detectAi(url.trim());
      setModels(found.models);
      setProvider(found.provider);
      setNumCtx(found.numCtx);
      /**
       * On anything but Ollama there is nothing to choose: the server was
       * started with a model and that is the one it will answer with. Picking
       * it here saves the writer confirming a decision they already made.
       */
      if (found.provider !== "ollama") setModel(found.models[0] ?? null);
      else if (model && !found.models.includes(model)) setModel(null);
    } catch (err) {
      setModels(null);
      setProvider(null);
      setError(err instanceof ApiError ? err.message : "could not reach that address");
    } finally {
      setConnecting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const settings = await api.saveAi({
        url: url.trim() || null,
        analysisModel: model,
        // Absent leaves whatever is stored alone; the field is never filled in
        // with a key it was not shown.
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setNumCtx(settings.numCtx ?? null);
      setProvider(settings.provider);
      setHasKey(settings.hasApiKey);
      setApiKey("");
      flash();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not save that");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="muted">Loading…</p>;

  const ollama = provider === "ollama";

  return (
    <div className="tpl-detail">
      <h4 className="tpl-section">The model</h4>
      <p className="pane-lede">
        Brigid talks to a model you run. Give it the address and it will work out
        what is answering — Ollama, llama.cpp, LM Studio, or anything else
        serving the same shape.
      </p>

      {error ? <div className="alert error">{error}</div> : null}

      <label className="field">
        <span>Address</span>
        <div className="row-actions">
          <input
            type="text"
            value={url}
            placeholder={PLACEHOLDER}
            onChange={(e) => {
              setUrl(e.target.value);
              // What was found belongs to the old address.
              setModels(null);
              setProvider(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void connect();
            }}
          />
          <button className="btn" type="button" disabled={connecting || !url.trim()} onClick={() => void connect()}>
            {connecting ? <RefreshCw size={14} className="spin" /> : <Plug size={14} />}
            {connecting ? "Looking…" : "Connect"}
          </button>
        </div>
      </label>

      {provider ? (
        <p className="muted small">
          {ollama ? (
            <>
              <strong>Ollama</strong> — {models?.length ?? 0} model
              {models?.length === 1 ? "" : "s"} installed.
            </>
          ) : (
            <>
              An <strong>OpenAI-compatible</strong> server. Whatever it is
              serving is what will answer; the model and the context window were
              settled when you started it.
            </>
          )}
        </p>
      ) : null}

      {ollama && models ? (
        <label className="field">
          <span>Model</span>
          <select value={model ?? ""} onChange={(e) => setModel(e.target.value || null)}>
            <option value="">Choose one…</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {provider && !ollama && model ? (
        <label className="field">
          <span>Serving</span>
          <input type="text" value={model} readOnly />
        </label>
      ) : null}

      {/*
        Only where one might be wanted. Ollama asks for nothing, and offering a
        key field beside it invites the question of what it is for.
      */}
      {provider && !ollama ? (
        <label className="field">
          <span>API key</span>
          <input
            type="password"
            value={apiKey}
            placeholder={hasKey ? "•••••••• (stored)" : "only if your server requires one"}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <span className="field-note">
            llama.cpp needs none. vLLM started with <code>--api-key</code> does,
            and so does anything behind a proxy. Stored in your own database, in
            the clear, alongside the manuscript — not a secret store.
          </span>
        </label>
      ) : null}

      {numCtx ? (
        <p className="muted small">
          Context window: {numCtx.toLocaleString()} tokens.
        </p>
      ) : provider && !ollama ? (
        <p className="muted small">
          This server did not say how large its context window is, so none is
          requested and whatever it was started with applies.
        </p>
      ) : null}

      <div className="row-actions">
        <button className={`btn${saved ? " saved" : ""}`} type="button" disabled={saving} onClick={() => void save()}>
          {saved ? "Saved!" : saving ? "Saving…" : "Save"}
        </button>
        {url.trim() ? (
          <button
            className="btn ghost"
            type="button"
            disabled={saving}
            onClick={async () => {
              setUrl("");
              setModel(null);
              setModels(null);
              setProvider(null);
              setNumCtx(null);
              setHasKey(false);
              await api.saveAi({ url: null, analysisModel: null, apiKey: null });
              flash();
            }}
          >
            Disconnect
          </button>
        ) : null}
      </div>

      <p className="muted small">
        Whatever address you give here is where your manuscript goes when you use
        the AI features. On a machine you run, it does not leave your network.
      </p>
    </div>
  );
}
