import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ApiError, api } from "../../api.js";
import type { DictionaryWord } from "../../api.js";
import { useDialogs } from "../../components/Dialogs.js";

/**
 * The checker's switch, and the words it has been taught.
 *
 * System-wide rather than per-manuscript: a character's name is spelled the
 * same way in the sequel, and nobody wants to teach it twice.
 */
export function SpellingPane() {
  const dialogs = useDialogs();
  const [enabled, setEnabled] = useState(true);
  const [words, setWords] = useState<DictionaryWord[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const { enabled: on, words: rows } = await api.getSpelling();
      setEnabled(on);
      setWords(rows);
      setLoaded(true);
    })();
  }, []);

  async function toggle(next: boolean) {
    setEnabled(next);
    try {
      await api.setSpellcheckEnabled(next);
    } catch {
      setEnabled(!next);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    const word = draft.trim();
    if (!word) return;
    setError(null);
    try {
      const { word: row } = await api.addDictionaryWord(word);
      setWords((current) =>
        current.some((w) => w.id === row.id)
          ? current
          : [...current, row].sort((a, b) => a.wordFolded.localeCompare(b.wordFolded)),
      );
      setDraft("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add that word.");
    }
  }

  async function remove(row: DictionaryWord) {
    const ok = await dialogs.confirm({
      title: "Remove from dictionary",
      message: `“${row.word}” will be underlined again wherever it appears.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await api.deleteDictionaryWord(row.id);
    setWords((current) => current.filter((w) => w.id !== row.id));
  }

  return (
    <div className="tpl-detail">
      <h4 className="tpl-section">Checking</h4>
      <div className="stack">
        <label className="check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => void toggle(e.target.checked)}
          />
          <span>
            Check spelling as I write <em>&mdash; underlines what it doesn&rsquo;t recognise</em>
          </span>
        </label>
      </div>
      <p className="tpl-note">
        The dictionary is downloaded once and checked in the browser, so nothing you write
        is sent anywhere.
      </p>

      <h4 className="tpl-section">Your dictionary</h4>
      <p className="tpl-note">
        Names, places, invented things — anything spelled on purpose. You can also add a
        word from the underline itself while writing.
      </p>

      <form className="dict-add" onSubmit={(e) => void add(e)}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a word"
          spellCheck={false}
          aria-label="Word to add"
        />
        <button className="btn" type="submit" disabled={!draft.trim()}>
          <Plus size={15} />
          Add
        </button>
      </form>
      {error ? <div className="alert error">{error}</div> : null}

      {!loaded ? null : words.length === 0 ? (
        <p className="tpl-empty">No words added yet.</p>
      ) : (
        <ul className="dict-list">
          {words.map((row) => (
            <li key={row.id}>
              <span className="dict-word">{row.word}</span>
              <button
                className="btn ghost"
                type="button"
                title={`Remove ${row.word}`}
                aria-label={`Remove ${row.word}`}
                onClick={() => void remove(row)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
