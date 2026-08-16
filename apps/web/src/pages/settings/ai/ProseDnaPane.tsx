import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { api, ApiError } from "../../../api.js";
import type { ProseDna, ProseSection } from "../../../api.js";
import { ProseProfile } from "./ProseProfile.js";
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

  const describe = async () => {
    setDescribing(true);
    setError(null);
    try {
      await api.describeProse(workId);
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

      <ProseProfile features={dna.features} voices={dna.voices} />

      <Commentary profile={profile} busy={describing} onDescribe={describe} />

      <Outliers dna={dna} labels={labels} />

      <Corpus
        sections={dna.sections}
        busy={busy}
        counted={counted.length}
        onChange={setSections}
      />
    </div>
  );
}

/**
 * What the measurements say, opening with the summary of them.
 *
 * The summary used to sit in a box of its own headed "Your voice, described",
 * above a second box headed "What the measurements say" — two containers, two
 * headings, and no way to tell from the outside that the first was a précis of
 * the second. It is the first paragraph now, which is what it always was.
 */
function Commentary({
  profile,
  busy,
  onDescribe,
}: {
  profile: ProseDna["profile"];
  busy: boolean;
  onDescribe: () => Promise<void>;
}) {
  const entries = profile?.commentary ?? [];
  const [open, setOpen] = useState<Set<number>>(new Set());
  const allOpen = entries.length > 0 && open.size === entries.length;

  return (
    <section className="dna-commentary">
      <div className="dna-card-head">
        <h4>What the measurements say</h4>
        <div className="row-actions">
          {entries.length > 0 ? (
            <button
              className="btn ghost"
              type="button"
              onClick={() => setOpen(allOpen ? new Set() : new Set(entries.map((_, i) => i)))}
            >
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          ) : null}
          {profile ? (
            <button
              className="btn ghost"
              type="button"
              disabled={busy}
              onClick={() => void onDescribe()}
              title="Read the measurements again"
            >
              {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
              Refresh
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
          <button className="btn" type="button" disabled={busy} onClick={() => void onDescribe()}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {busy ? "Reading…" : "Describe my voice"}
          </button>
        </>
      ) : (
        <>
          {/* The summary, which is the thing to read if only one thing is read. */}
          <p className="dna-summary-para">{profile.card || "—"}</p>
          {profile.stale ? (
            <p className="muted small">
              Written about a different set of sections than are counted now.
            </p>
          ) : null}

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
        </>
      )}
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
          shown when it needs to sound like you — not a judgment about which
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

/**
 * Which sections count towards the writer's normal.
 *
 * A list and a checkbox, in the order the sections are read. It had a word
 * count, a distance, and three sentences explaining the difference between
 * being excluded and being unmeasured — all of it true, none of it what
 * somebody opening this needs, which is to find a chapter and take it out.
 */
function Corpus({
  sections,
  busy,
  counted,
  onChange,
}: {
  sections: ProseSection[];
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
            Everything counts unless you take it out. Leave out anything too
            rough to be typical of you — it is still measured either way.
          </p>
          <p className="muted small">
            Name a <strong>voice</strong> on any section meant to read
            differently — letters, a dream, a second narrator, a document. Once
            three sections share a name and run to a few thousand words between
            them, that voice gets a normal of its own: its sections stop being
            reported as departures from the book, and you can switch the tracks
            at the top of this tab to look at it on its own.
          </p>

          <ul className="dna-sections">
            {sections.map((section) => (
              <li key={section.blockId} className={section.included ? "" : "out"}>
                <label>
                  <input
                    type="checkbox"
                    checked={section.included}
                    disabled={busy}
                    onChange={(e) =>
                      void onChange([section.blockId], { included: e.target.checked })
                    }
                  />
                  <span>{section.label || "Untitled"}</span>
                </label>
                <input
                  type="text"
                  className="dna-voice"
                  defaultValue={section.voice ?? ""}
                  placeholder="voice"
                  title="Name a voice when a section is meant to read differently — letters, a dream, a second narrator"
                  disabled={busy}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value === (section.voice ?? "")) return;
                    void onChange([section.blockId], { voice: value || null });
                  }}
                />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
