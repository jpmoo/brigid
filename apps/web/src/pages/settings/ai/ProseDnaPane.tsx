import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { api, ApiError } from "../../../api.js";
import type { ProseDna, ProseSection } from "../../../api.js";
import { DnaHelix } from "./DnaHelix.js";
import { Markdown } from "./Markdown.js";

/**
 * ProseDNA.
 *
 * What the writing measures out to, what that says, and which sections count
 * towards it. The measuring needs no model and neither does most of this pane —
 * only the description does, so everything else is shown whether or not Ollama
 * is connected.
 */

const wordFmt = new Intl.NumberFormat();

export function ProseDnaPane({ workId }: { workId: string }) {
  const [dna, setDna] = useState<ProseDna | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [describing, setDescribing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDna(await api.proseDna(workId));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not read the fingerprint");
    }
  }, [workId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setSections = async (
    blockIds: string[],
    patch: { included?: boolean; voice?: string | null },
  ) => {
    setBusy(true);
    try {
      await api.setStyleSections(workId, { blockIds, ...patch });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "could not change that");
    } finally {
      setBusy(false);
    }
  };

  const describe = async (force: boolean) => {
    setDescribing(true);
    setError(null);
    try {
      await api.describeProse(workId, force);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "the model did not answer");
    } finally {
      setDescribing(false);
    }
  };

  // The names come with the measurements: one call, and they cannot disagree
  // with what was measured.
  const labels = new Map(
    (dna?.sections ?? []).map((s) => [s.blockId, s.label || "Untitled"]),
  );

  if (!dna) {
    return <p className="muted">Measuring…</p>;
  }

  const { corpus, profile } = dna;
  const counted = dna.sections.filter((s) => s.included);

  return (
    <div className="dna-pane">
      {error ? <div className="alert error">{error}</div> : null}

      <p className="pane-lede">
        Every section is measured across a couple of hundred features — sentence
        shape, punctuation, how speech is attributed, how close the narrator
        stands. None of it needs the AI. What it gives you is a picture of your
        own hand, and a way of finding the places that don&rsquo;t match it.
      </p>

      <div className="dna-summary">
        <strong>{wordFmt.format(corpus.words)}</strong> words across{" "}
        <strong>{corpus.sections}</strong> sections counted towards your normal
        {corpus.voices.length > 0 ? (
          <>
            , with separate readings for{" "}
            {corpus.voices.map((v, i) => (
              <span key={v}>
                {i > 0 ? ", " : ""}
                <em>{v}</em>
              </span>
            ))}
          </>
        ) : null}
        .
      </div>

      {corpus.thin ? (
        <div className="alert">
          Under {wordFmt.format(corpus.thinBelow)} words the numbers below will
          keep moving as you write. They are worth looking at; they are not yet
          worth arguing with.
        </div>
      ) : null}

      <DnaHelix strands={dna.strands} />

      <Card
        profile={profile}
        busy={describing}
        onDescribe={describe}
        onSave={async (card) => {
          await api.saveStyleCard(workId, card);
          await load();
        }}
      />

      {profile && profile.commentary.length > 0 ? (
        <Commentary entries={profile.commentary} />
      ) : null}

      <Outliers dna={dna} labels={labels} />

      <Corpus
        sections={dna.sections}
        labels={labels}
        busy={busy}
        counted={counted.length}
        onChange={setSections}
      />
    </div>
  );
}

/** The voice in prose. The writer's own words outrank the model's. */
function Card({
  profile,
  busy,
  onDescribe,
  onSave,
}: {
  profile: ProseDna["profile"];
  busy: boolean;
  onDescribe: (force: boolean) => Promise<void>;
  onSave: (card: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <section className="dna-card">
      <div className="dna-card-head">
        <h4>Your voice, described</h4>
        <div className="row-actions">
          {profile ? (
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => void onDescribe(profile.cardEdited)}
              title={
                profile.cardEdited
                  ? "Rewrite it, discarding your edit"
                  : "Read the measurements again"
              }
            >
              {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              {profile.cardEdited ? "Rewrite" : "Refresh"}
            </button>
          ) : null}
          {profile && !editing ? (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setDraft(profile.card);
                setEditing(true);
              }}
            >
              Edit
            </button>
          ) : null}
        </div>
      </div>

      {!profile ? (
        <>
          <p className="muted">
            The measurements are ready. Ask the model to read them and say what
            they describe — this is the only part of ProseDNA that needs it.
          </p>
          <button className="btn" type="button" disabled={busy} onClick={() => void onDescribe(false)}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {busy ? "Reading…" : "Describe my voice"}
          </button>
        </>
      ) : editing ? (
        <>
          <textarea
            className="dna-card-edit"
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="row-actions">
            <button
              className="btn"
              type="button"
              onClick={async () => {
                await onSave(draft);
                setEditing(false);
              }}
            >
              Save
            </button>
            <button className="btn ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <blockquote className="dna-card-text">{profile.card || "—"}</blockquote>
          <p className="muted small">
            {profile.cardEdited ? "Edited by you. " : null}
            {profile.stale
              ? "Written about a different set of sections than are counted now."
              : null}
          </p>
        </>
      )}
    </section>
  );
}

function Commentary({ entries }: { entries: { heading: string; body: string }[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set([0]));
  const allOpen = open.size === entries.length;

  return (
    <section className="dna-commentary">
      <div className="dna-card-head">
        <h4>What the measurements say</h4>
        <button
          className="btn ghost"
          type="button"
          onClick={() =>
            setOpen(allOpen ? new Set() : new Set(entries.map((_, i) => i)))
          }
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {entries.map((entry, i) => (
        <div key={entry.heading} className={`dna-entry${open.has(i) ? " open" : ""}`}>
          <button
            type="button"
            className="dna-entry-head"
            onClick={() =>
              setOpen((held) => {
                const next = new Set(held);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                return next;
              })
            }
          >
            <ChevronRight size={14} className="twisty" />
            {entry.heading}
          </button>
          {open.has(i) ? (
            <div className="dna-entry-body">
              <Markdown text={entry.body} />
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

/**
 * The sections nearest and furthest from the middle.
 *
 * "Most characteristic", not "best" — and the difference is worth the words,
 * because a writer's finest page may well be the one where they departed from
 * themselves. What this finds is what they usually sound like.
 */
function Outliers({
  dna,
  labels,
}: {
  dna: ProseDna;
  labels: Map<string, string>;
}) {
  const byId = useMemo(
    () => new Map(dna.sections.map((s) => [s.blockId, s])),
    [dna.sections],
  );

  if (dna.typical.length === 0 && dna.atypical.length === 0) return null;

  return (
    <section className="dna-outliers">
      <div className="dna-col">
        <h4>Most like the rest of your book</h4>
        <p className="muted small">
          Closest to the middle of everything counted. This is what the model is
          shown when it needs to sound like you — not a judgement about which
          pages are best.
        </p>
        <ul className="dna-list">
          {dna.typical.map((id) => (
            <li key={id}>
              <span className="dna-sec">{labels.get(id) ?? "Untitled"}</span>
              <span className="dna-delta">{byId.get(id)?.delta.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="dna-col">
        <h4>Least like the rest</h4>
        <p className="muted small">
          Furthest out. Sometimes a draft, sometimes a different voice you
          haven&rsquo;t tagged — and sometimes the best thing in the book.
        </p>
        <ul className="dna-list">
          {dna.atypical.map((id) => {
            const section = byId.get(id);
            return (
              <li key={id}>
                <span className="dna-sec">{labels.get(id) ?? "Untitled"}</span>
                <span className="dna-delta">{section?.delta.toFixed(2)}</span>
                {section && section.moved.length > 0 ? (
                  <span className="dna-why">
                    {section.moved
                      .slice(0, 3)
                      .map((m) => `${m.label} ${m.z > 0 ? "up" : "down"}`)
                      .join(", ")}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Which sections count, and which voice each is written in. */
function Corpus({
  sections,
  labels,
  busy,
  counted,
  onChange,
}: {
  sections: ProseSection[];
  labels: Map<string, string>;
  busy: boolean;
  counted: number;
  onChange: (
    blockIds: string[],
    patch: { included?: boolean; voice?: string | null },
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="dna-corpus">
      <button className="dna-corpus-head" type="button" onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className={`twisty${open ? " open" : ""}`} />
        What counts towards your normal
        <span className="muted small">
          {counted} of {sections.length} sections
        </span>
      </button>

      {open ? (
        <>
          <p className="muted small">
            Everything counts unless you take it out. Exclude anything too rough
            to be typical of you — it is still measured, so you can still ask
            whether it sounds like you yet. Give a section a voice when it is
            meant to read differently: letters, a dream, a second narrator. Each
            voice gets its own normal once there are three of them and a few
            thousand words.
          </p>

          <table className="dna-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Words</th>
                <th>Distance</th>
                <th>Voice</th>
                <th>Counts</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <tr key={section.blockId} className={section.included ? "" : "out"}>
                  <td>{labels.get(section.blockId) ?? "Untitled"}</td>
                  <td className="num">{wordFmt.format(section.words)}</td>
                  <td className="num">
                    {section.reliable ? (
                      section.delta.toFixed(2)
                    ) : (
                      <span className="muted" title="Too short to draw a conclusion from">
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      className="dna-voice"
                      defaultValue={section.voice ?? ""}
                      placeholder="—"
                      disabled={busy}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value === (section.voice ?? "")) return;
                        void onChange([section.blockId], { voice: value || null });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={section.included}
                      disabled={busy}
                      onChange={(e) =>
                        void onChange([section.blockId], { included: e.target.checked })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </section>
  );
}
